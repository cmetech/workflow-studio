import { beforeEach, describe, expect, it } from 'vitest'
import {
  $activeActivity,
  $inspectorPanelOpen,
  $workspacePanelOpen,
  closeTransientPanels,
  openInspectorPanel,
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
})
