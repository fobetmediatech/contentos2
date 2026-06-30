/**
 * Keyword → hero image for the strategy deck, via Pollinations.ai (AI-generated, no API key).
 * Loads as a plain <img src> (works cross-origin for display), so no proxy is needed and it
 * works on localhost too. The deck always renders a graceful fallback (themed background) if the
 * image is missing or slow, so it can never break a slide.
 */
export function heroImageUrl(keyword: string, seed = 7, width = 1280, height = 720): string {
  const prompt = `${keyword.trim()}, cinematic professional photograph, high detail, no text, no watermark`
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}&model=flux`
}
