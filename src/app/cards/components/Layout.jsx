import React from 'react';
import { AutoGrid } from '@hubspot/ui-extensions';

// A responsive row of equal-width fields: as many columns as fit at `min` px each, wrapping to fewer
// (down to one) when the card is narrow, e.g. a split-screen window. Help text goes in field tooltips
// so every input lines up.
export function Row({ children, min = 180 }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <AutoGrid columnWidth={min} flexible gap="medium">
      {items}
    </AutoGrid>
  );
}

// HubSpot's Select treats '' as "nothing chosen" and shows its placeholder, so options that mean
// "automatic" or "none" use a sentinel value in the UI and map back to '' in state.
export const NONE = '__none__';
export const toSelect = (v) => (v === '' || v === null || v === undefined ? NONE : String(v));
export const fromSelect = (v) => (v === NONE ? '' : String(v));
