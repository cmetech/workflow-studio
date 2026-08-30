import { beforeEach, describe, expect, it } from 'vitest'
import {
  $activeActivity,
  $inspectorPanelOpen,
  $workspacePanelOpen,
  closeTransientPanels,
  openInspectorPanel,
  resolveWorkbenchSurface,
  returnToWorkflow,
  showActivity,
  toggleActivityPanel,
} from './shell'

describe('responsive shell state', () => {
  beforeEach(() => {
    $activeActivity.set('explorer')
    $workspacePanelOpen.set(true)
    $inspectorPanelOpen.set(true)
  })

  it('opens a selected activity and toggles the already selected activity closed', () => {
    closeTransientPanels()
    expect($workspacePanelOpen.get()).toBe(false)

    toggleActivityPanel('explorer')
    expect($activeActivity.get()).toBe('explorer')
    expect($workspacePanelOpen.get()).toBe(true)

    toggleActivityPanel('explorer')
    expect($workspacePanelOpen.get()).toBe(false)
  })

  it('switches activity while opening its panel and opens the inspector independently', () => {
    closeTransientPanels()

    toggleActivityPanel('nodes')
    openInspectorPanel()

    expect($activeActivity.get()).toBe('nodes')
    expect($workspacePanelOpen.get()).toBe(true)
    expect($inspectorPanelOpen.get()).toBe(true)
  })

  it('opens page activities without drawers and returns to the prior authoring target', () => {
    showActivity('nodes')
    $workspacePanelOpen.set(false)
    showActivity('settings')

    expect($activeActivity.get()).toBe('settings')
    expect($workspacePanelOpen.get()).toBe(false)
    expect($inspectorPanelOpen.get()).toBe(false)
    expect(resolveWorkbenchSurface('settings', true)).toBe('settings')

    returnToWorkflow()
    expect($activeActivity.get()).toBe('nodes')
    expect($workspacePanelOpen.get()).toBe(false)
    expect(resolveWorkbenchSurface('nodes', true)).toBe('authoring')
    expect(resolveWorkbenchSurface('explorer', false)).toBe('welcome')
  })
})
