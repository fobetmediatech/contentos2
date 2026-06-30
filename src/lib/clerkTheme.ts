/**
 * Clerk appearance.variables for the Terracotta system — keyed by color scheme.
 *
 * Clerk derives its shades from these in JS, so they must be real hex (not the
 * CSS vars the rest of the app uses). Pair with `useColorScheme()` so the Clerk
 * card matches the active light/dark theme instead of being a fixed dark box.
 * Values mirror tokens.css.
 */
type Scheme = 'light' | 'dark'

const DARK = {
  colorBackground: '#382B21',
  colorText: '#F5DFC5',
  colorTextSecondary: '#CBB093',
  colorPrimary: '#DFA477',
  colorTextOnPrimaryBackground: '#2C2119',
  colorInputBackground: '#463629',
  colorInputText: '#F5DFC5',
  colorNeutral: '#CBB093',
  colorDanger: '#CB5F4F',
}

const LIGHT = {
  colorBackground: '#FFFCF6',
  colorText: '#3A2218',
  colorTextSecondary: '#7A5544',
  colorPrimary: '#A4624D',
  colorTextOnPrimaryBackground: '#F5DFC5',
  colorInputBackground: '#F4E4CE',
  colorInputText: '#3A2218',
  colorNeutral: '#7A5544',
  colorDanger: '#B0463A',
}

export function clerkVariables(scheme: Scheme) {
  const base = scheme === 'light' ? LIGHT : DARK
  return {
    ...base,
    borderRadius: '10px',
    fontFamily: '"Outfit", sans-serif',
    fontSize: '14px',
  }
}
