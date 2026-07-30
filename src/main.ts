import { mount } from 'svelte'
import App from './app/App.svelte'
import './app.css'
import './styles/tokens.css'
import './styles/loop24.css'
import { synchronizeBrandTheme } from './lib/branding/theme-sync'
import { activeBrandManifest, themePreference } from './stores/branding'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Workflow Studio could not find its application root.')
}

const stopThemeSynchronization = synchronizeBrandTheme(activeBrandManifest, themePreference)

import.meta.hot?.dispose(stopThemeSynchronization)

mount(App, { target })
