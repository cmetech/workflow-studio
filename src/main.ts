import { mount } from 'svelte'
import App from './app/App.svelte'
import './app.css'
import './styles/tokens.css'
import './styles/loop24.css'
import { loadBundledBrand } from './lib/branding/load-brand'
import { synchronizeBrandTheme } from './lib/branding/theme-sync'
import { themePreference } from './stores/branding'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Workflow Studio could not find its application root.')
}

const brand = loadBundledBrand()
const stopThemeSynchronization = synchronizeBrandTheme(brand, themePreference)

import.meta.hot?.dispose(stopThemeSynchronization)

mount(App, { target })
