import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContributorWallView } from './ContributorWall'

describe('ContributorWallView', () => {
  it('renders a quiet loading state', () => {
    const html = renderToStaticMarkup(<ContributorWallView state={{ status: 'loading' }} />)
    expect(html).toContain('Loading GitHub contributors')
  })

  it('renders an actionable failure state', () => {
    const html = renderToStaticMarkup(<ContributorWallView state={{ status: 'error' }} />)
    expect(html).toContain('Profiles are taking a break')
    expect(html).toContain('https://github.com/nannndev/beacon/graphs/contributors')
  })

  it('invites the next contributor when GitHub returns no users', () => {
    const html = renderToStaticMarkup(
      <ContributorWallView state={{ status: 'ready', contributors: [] }} />,
    )
    expect(html).toContain('You could be the next contributor')
  })

  it('renders a linked profile with an exact contribution count', () => {
    const html = renderToStaticMarkup(
      <ContributorWallView
        state={{
          status: 'ready',
          contributors: [
            {
              login: 'ada',
              profileUrl: 'https://github.com/ada',
              avatarUrl: 'https://avatars.githubusercontent.com/u/1',
              contributions: 12,
            },
          ],
        }}
      />,
    )
    expect(html).toContain('href="https://github.com/ada"')
    expect(html).toContain('@ada')
    expect(html).toContain('12 contributions')
  })
})
