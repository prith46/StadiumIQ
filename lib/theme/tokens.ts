export const tokens = {
  color: {
    accent: '#2563EB',        // FIFA Blue — primary accent, do not change
    accentHover: '#1D4ED8',
    canvas: '#FAFAFA',        // page background
    surface: '#FFFFFF',       // card background
    border: '#E5E7EB',        // hairline border
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    inverse: '#FFFFFF',        // text/icon color on accent or dark surfaces
    surfaceHover: '#F9FAFB',   // hover state for surface controls
    track: '#EDEFF2',          // segmented-control track background
    dangerSubtle: '#FEF2F2',   // subtle danger background (toast, banners)
    overlay: 'rgba(17, 24, 39, 0.1)', // modal/dialog backdrop scrim
    heatmapLow: '#C0DD97',    // green — clear
    heatmapMed: '#FAC775',    // amber — busy
    heatmapHigh: '#F09595',   // red — crowded
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
  radius: {
    card: '12px',
    control: '8px',
    pill: '999px',
  },
  shadow: {
    card: '0 1px 3px rgba(17, 24, 39, 0.06), 0 1px 2px rgba(17, 24, 39, 0.04)',
    elevated: '0 4px 12px rgba(17, 24, 39, 0.08)',
  },
  spacing: {
    xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', xxl: '48px',
  },
} as const;
