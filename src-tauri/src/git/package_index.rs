//! Narrow shared-file authority guard; package schema and digest algebra stay in TypeScript.
use super::{GitError, GitResult};
use crate::workspace::package_hash::canonical;
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
fn invalid() -> GitError {
    GitError::new(
        "git_package_index_conflict",
        "The shared index contains ambiguous identities or changes outside the selected package.",
    )
}
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = Unique;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("JSON without duplicate object keys")
            }
            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Unique, E> {
                Ok(Unique(Value::Bool(value)))
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Unique, E> {
                Ok(Unique(Value::Number(value.into())))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Unique, E> {
                Ok(Unique(Value::Number(value.into())))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Unique, E> {
                Number::from_f64(value)
                    .map(|value| Unique(Value::Number(value)))
                    .ok_or_else(|| E::custom("invalid number"))
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Unique, E> {
                Ok(Unique(Value::String(value.into())))
            }
            fn visit_string<E: de::Error>(self, value: String) -> Result<Unique, E> {
                Ok(Unique(Value::String(value)))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Unique, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = seq.next_element::<Unique>()? {
                    values.push(value.0);
                }
                Ok(Unique(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Unique, A::Error> {
                let mut values = Map::new();
                while let Some((key, value)) = map.next_entry::<String, Unique>()? {
                    if values.insert(key, value.0).is_some() {
                        return Err(de::Error::custom("duplicate key"));
                    }
                }
                Ok(Unique(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(UniqueVisitor)
    }
}
fn parse(text: &str, selected: &str) -> GitResult<(Value, BTreeMap<String, Value>, Option<Value>)> {
    let Unique(mut value) = serde_json::from_str(text).map_err(|_| invalid())?;
    let entries = value
        .as_object_mut()
        .and_then(|object| object.remove("packages"))
        .ok_or_else(invalid)?;
    let entries = entries.as_array().ok_or_else(invalid)?;
    let mut paths = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut selected_entry = None;
    for entry in entries {
        let path = entry
            .get("packagePath")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if !ids.insert(canonical(id)) {
            return Err(invalid());
        }
        let key = canonical(path);
        if paths.insert(key.clone(), entry.clone()).is_some() {
            return Err(invalid());
        }
        if key == canonical(selected) {
            if path != selected {
                return Err(invalid());
            }
            selected_entry = Some(entry.clone());
        }
    }
    paths.remove(&canonical(selected));
    Ok((value, paths, selected_entry))
}
pub(super) fn verify(
    before: Option<&str>,
    after: &str,
    selected: &str,
    version: Option<&str>,
) -> GitResult<()> {
    let empty = "{\"schemaVersion\":1,\"packages\":[]}";
    let (before_top, before_entries, _) = parse(before.unwrap_or(empty), selected)?;
    let (after_top, after_entries, selected_entry) = parse(after, selected)?;
    if before_top != after_top || before_entries != after_entries {
        return Err(invalid());
    }
    match (version, selected_entry) {
        (None, None) => Ok(()),
        (Some(version), Some(entry))
            if entry.get("version").and_then(Value::as_str) == Some(version) =>
        {
            Ok(())
        }
        _ => Err(invalid()),
    }
}
