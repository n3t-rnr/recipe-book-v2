/**
 * Arrow keys of a radio group (NF-11, WAI-ARIA radio group pattern): the sort options of the filter sheet
 * and the segmented control. Returns the option to check and focus, or null for any other key. Loaded
 * with the filter sheet only (NF-01).
 */
export function radioKeys(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
