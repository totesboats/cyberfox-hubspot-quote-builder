import React from 'react';
import { Box, Flex } from '@hubspot/ui-extensions';

// One row of equal-width fields (or weighted with `weights`). Help text goes in field tooltips
// so every input in the row lines up.
export function Row({ children, weights = [] }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <Flex direction="row" gap="medium" align="end">
      {items.map((child, i) => (
        <Box key={i} flex={weights[i] || 1}>
          {child}
        </Box>
      ))}
    </Flex>
  );
}

// HubSpot's Select treats '' as "nothing chosen" and shows its placeholder, so options that mean
// "automatic" or "none" use a sentinel value in the UI and map back to '' in state.
export const NONE = '__none__';
export const toSelect = (v) => (v === '' || v === null || v === undefined ? NONE : String(v));
export const fromSelect = (v) => (v === NONE ? '' : String(v));
