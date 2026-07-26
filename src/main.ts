import { mount } from 'svelte'
import App from './app/App.svelte'
import './app.css'
import './styles/tokens.css'
import './styles/loop24.css'
import { applyBrandTheme, loadBundledBrand, resolveThemeMode } from './lib/branding/load-brand'
import { themePreference } from './stores/branding'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Workflow Studio could not find its application root.')
}

const brand = loadBundledBrand()
themePreference.subscribe((preference) => {
  applyBrandTheme(brand, resolveThemeMode(preference))
})

mount(App, { target })
