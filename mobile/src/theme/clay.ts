/**
 * Claymorphism tokens.
 *
 * Clay surfaces read as soft, inflated objects rather than flat cards. Three
 * things make that work, and all three have to be present or it just looks
 * like a drop shadow:
 *
 *   1. a large, diffuse outer shadow, so the surface floats;
 *   2. an inset highlight along the top edge, as if lit from above;
 *   3. an inset shadow along the bottom edge, giving the surface thickness.
 *
 * React Native supports inset shadows through the `boxShadow` style prop from
 * 0.76 onwards, so these are real shadows rather than layered views faking it.
 *
 * The shadows are neutral grey, not tinted, because the palette they sit on is
 * the web app's neutral one and a coloured shadow would pull the whole app
 * away from it. In light mode a card is the same white as the page behind it,
 * so the outer shadow does all the separating - it is deliberately a shade
 * stronger than it would need to be on a tinted background.
 */

export interface ClayTokens {
  /** A resting surface: cards, list rows, tiles. */
  surface: string;
  /** Something meant to be pressed: buttons, tabs, chips. */
  raised: string;
  /** The same thing while held down - the inflation collapses. */
  pressed: string;
  /** A hollow: text inputs and anything that should look carved in. */
  inset: string;
  /**
   * A filled button. Shape only - the inset highlight and shade give it a
   * moulded edge, and there is no outer shadow, because a cast in the button's
   * own colour reads as a glow around it.
   */
  filled: string;
  /** Clay is round. These replace the sharper web-derived radii. */
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
}

const CLAY_RADIUS = { sm: 12, md: 16, lg: 20, xl: 28, pill: 999 };

/**
 * Light: white cards on a white page, so the outer shadow carries the shape.
 * The inset highlight is near-invisible on white by design - it earns its keep
 * on the grey surfaces (muted, secondary) that share this token.
 */
export const lightClay: ClayTokens = {
  surface: [
    '0px 10px 26px rgba(0, 0, 0, 0.09)',
    '0px 2px 6px rgba(0, 0, 0, 0.05)',
    'inset 0px 3px 6px rgba(255, 255, 255, 0.90)',
    'inset 0px -5px 10px rgba(0, 0, 0, 0.045)',
  ].join(', '),

  raised: [
    '0px 8px 18px rgba(0, 0, 0, 0.11)',
    'inset 0px 4px 7px rgba(255, 255, 255, 0.75)',
    'inset 0px -6px 10px rgba(0, 0, 0, 0.08)',
  ].join(', '),

  // Held down: the outer shadow all but disappears and the insets swap, so
  // the surface reads as pushed into the page.
  pressed: [
    '0px 1px 3px rgba(0, 0, 0, 0.09)',
    'inset 0px 4px 8px rgba(0, 0, 0, 0.13)',
    'inset 0px -2px 4px rgba(255, 255, 255, 0.55)',
  ].join(', '),

  inset: [
    'inset 0px 3px 7px rgba(0, 0, 0, 0.11)',
    'inset 0px -2px 3px rgba(255, 255, 255, 0.85)',
  ].join(', '),

  filled: [
    'inset 0px 4px 7px rgba(255, 255, 255, 0.28)',
    'inset 0px -6px 10px rgba(0, 0, 0, 0.18)',
  ].join(', '),

  radius: CLAY_RADIUS,
};

/**
 * Dark: cards already sit lighter than the page, so the shadow only has to
 * deepen that. The highlight stays faint - a bright inset on a dark surface
 * reads as plastic rather than clay.
 */
export const darkClay: ClayTokens = {
  surface: [
    '0px 10px 24px rgba(0, 0, 0, 0.45)',
    '0px 2px 6px rgba(0, 0, 0, 0.30)',
    'inset 0px 3px 6px rgba(255, 255, 255, 0.07)',
    'inset 0px -5px 10px rgba(0, 0, 0, 0.35)',
  ].join(', '),

  raised: [
    '0px 8px 18px rgba(0, 0, 0, 0.50)',
    'inset 0px 4px 7px rgba(255, 255, 255, 0.09)',
    'inset 0px -6px 10px rgba(0, 0, 0, 0.45)',
  ].join(', '),

  pressed: [
    '0px 1px 3px rgba(0, 0, 0, 0.40)',
    'inset 0px 4px 8px rgba(0, 0, 0, 0.55)',
    'inset 0px -2px 4px rgba(255, 255, 255, 0.05)',
  ].join(', '),

  inset: [
    'inset 0px 3px 7px rgba(0, 0, 0, 0.55)',
    'inset 0px -2px 3px rgba(255, 255, 255, 0.05)',
  ].join(', '),

  filled: [
    'inset 0px 4px 7px rgba(255, 255, 255, 0.18)',
    'inset 0px -6px 10px rgba(0, 0, 0, 0.35)',
  ].join(', '),

  radius: CLAY_RADIUS,
};
