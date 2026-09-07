import { expect, test, type Page } from '@playwright/test'
import { expectRoutedGeometry, readCanvasGeometry } from './support'

interface GeometryFixture {
  readonly nodes: readonly { id: string; x: number; y: number }[]
  readonly edges: readonly { id: string; source: string; target: string; path: string }[]
}

/** Literal SVG and 216x104 node boxes exercise the browser reader and its independent oracle together. */
async function readFixture(page: Page, fixture: GeometryFixture) {
  await page.setContent(`
    <style>body { margin: 0 } .svelte-flow__node { position: absolute; width: 216px; height: 104px }</style>
    ${fixture.nodes.map(({ id, x, y }) => `<div class="svelte-flow__node" data-id="${id}" style="left:${x + 300}px;top:${y + 300}px"></div>`).join('')}
    <svg style="position:absolute;left:0;top:0;overflow:visible" width="1200" height="900">
      <g transform="translate(300 300)">
        ${fixture.edges.map(({ id, source, target, path }) => `<g class="svelte-flow__edge" data-id="${id}" aria-label="Dependency from ${source} to ${target}"><path class="workflow-edge" d="${path}" /></g>`).join('')}
      </g>
    </svg>
  `)
  return readCanvasGeometry(page)
}

const crossingNodes = [
  { id: 'a', x: -216, y: -52 },
  { id: 'b', x: 600, y: 48 },
  { id: 'c', x: -216, y: -252 },
  { id: 'd', x: 600, y: 248 },
]

for (const [name, path] of [
  ['an L/Q join with normal 8px corners', 'M 0 0 L 300 0 Q 308 0 308 8 L 308 92 Q 308 100 316 100 L 600 100'],
  ['collinear L subdivisions and a repeated point', 'M 0 0 L 150 0 L 300 0 L 300 0 L 308 0 L 308 100 L 600 100'],
]) {
  test(`the geometry oracle detects a crossing at (300, 0) at ${name}`, async ({ page }) => {
    const fixture: GeometryFixture = {
      nodes: crossingNodes,
      edges: [
        { id: 'a-b', source: 'a', target: 'b', path: path! },
        {
          id: 'c-d',
          source: 'c',
          target: 'd',
          path: 'M 0 -200 L 292 -200 Q 300 -200 300 -192 L 300 292 Q 300 300 308 300 L 600 300',
        },
      ],
    }
    const geometry = await readFixture(page, fixture)
    expect(() => expectRoutedGeometry(geometry, fixture)).toThrow(/300:0/)
    expectRoutedGeometry(geometry, fixture, 1)
  })
}

const fanNodes = [
  { id: 'source', x: 0, y: 0 },
  { id: 'upper', x: 500, y: -152 },
  { id: 'lower', x: 500, y: 148 },
]

test('the geometry oracle rejects a long shared lane split into short L segments', async ({ page }) => {
  const fixture: GeometryFixture = {
    nodes: fanNodes,
    edges: [
      {
        id: 'up',
        source: 'source',
        target: 'upper',
        path: 'M 216 32 L 224 32 L 224 48 L 244 48 L 264 48 L 284 48 L 304 48 L 324 48 L 344 48 L 344 -100 L 500 -100',
      },
      {
        id: 'down',
        source: 'source',
        target: 'lower',
        path: 'M 216 64 L 224 64 L 224 48 L 244 48 L 264 48 L 284 48 L 304 48 L 324 48 L 344 48 L 344 200 L 500 200',
      },
    ],
  }
  const geometry = await readFixture(page, fixture)
  expect(() => expectRoutedGeometry(geometry, fixture)).toThrow(/share a long lane/)
})

test('the geometry oracle retains short shared fan lanes and true bend endpoint exclusions', async ({ page }) => {
  const fixture: GeometryFixture = {
    nodes: fanNodes,
    edges: [
      {
        id: 'up',
        source: 'source',
        target: 'upper',
        path: 'M 216 32 L 224 32 L 224 48 L 232 48 L 240 48 L 240 -100 L 500 -100',
      },
      {
        id: 'down',
        source: 'source',
        target: 'lower',
        path: 'M 216 64 L 224 64 L 224 48 L 232 48 L 240 48 L 240 200 L 500 200',
      },
    ],
  }
  expectRoutedGeometry(await readFixture(page, fixture), fixture)
})

test('the geometry oracle preserves separate orthogonal routes with rounded 8px corners', async ({ page }) => {
  const fixture: GeometryFixture = {
    nodes: fanNodes,
    edges: [
      {
        id: 'up',
        source: 'source',
        target: 'upper',
        path: 'M 216 32 L 292 32 Q 300 32 300 24 L 300 -92 Q 300 -100 308 -100 L 500 -100',
      },
      {
        id: 'down',
        source: 'source',
        target: 'lower',
        path: 'M 216 64 L 292 64 Q 300 64 300 72 L 300 192 Q 300 200 308 200 L 500 200',
      },
    ],
  }
  expectRoutedGeometry(await readFixture(page, fixture), fixture)
})
