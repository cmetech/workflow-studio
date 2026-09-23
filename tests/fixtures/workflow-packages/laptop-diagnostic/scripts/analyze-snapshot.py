"""Synthetic fixture; Studio analyzes this text without executing it."""
import json

print(json.dumps({"source": "synthetic", "cpu_percent": 25, "memory_percent": 40}))
