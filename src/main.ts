import './app.css'
import './styles/tokens.css'
import './styles/loop24.css'
import { installRuntimeBootstrap } from '$runtime-bootstrap'

async function startApplication(): Promise<void> {
  await installRuntimeBootstrap()

  const [svelte, appModule, themeModule, brandStores] = await Promise.all([
    import('svelte'),
    import('./app/App.svelte'),
    import('./lib/branding/theme-sync'),
    import('./stores/branding'),
  ])
  const target = document.getElementById('app')
  if (!target) throw new Error('Workflow Studio could not find its application root.')

  const stopThemeSynchronization = themeModule.synchronizeBrandTheme(
    brandStores.activeBrandManifest,
    brandStores.themePreference,
  )
  import.meta.hot?.dispose(stopThemeSynchronization)
  svelte.mount(appModule.default, { target })
}

void startApplication()
