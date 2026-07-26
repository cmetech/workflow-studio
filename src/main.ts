import { mount } from 'svelte'
import App from './app/App.svelte'
import './app.css'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Workflow Studio could not find its application root.')
}

mount(App, { target })
