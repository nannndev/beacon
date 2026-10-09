export interface ShotPair {
  light: string
  dark: string
}

interface ThemedShotProps {
  shot: ShotPair
  alt: string
  className?: string
  eager?: boolean
}

// Product screenshots are captured in both themes at 1440x900 (16:10).
export const SHOT_WIDTH = 2160
export const SHOT_HEIGHT = 1350

/**
 * Shows the screenshot that matches the page theme. Both images are in the
 * DOM, but the hidden one is display:none, so with lazy loading the browser
 * only downloads the variant the visitor actually sees.
 */
export function ThemedShot({ shot, alt, className = '', eager = false }: ThemedShotProps) {
  const loading = eager ? 'eager' : 'lazy'
  return (
    <>
      <img
        src={shot.light}
        alt={alt}
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        loading={loading}
        decoding="async"
        className={`dark:hidden ${className}`}
      />
      <img
        src={shot.dark}
        alt={alt}
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        loading={loading}
        decoding="async"
        className={`hidden dark:block ${className}`}
      />
    </>
  )
}
