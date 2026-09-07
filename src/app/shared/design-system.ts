export const AppColors = {
  backgroundMain: '#050608',
  backgroundSecondary: '#0B0E13',
  surface: '#11161E',
  surfaceElevated: '#161C26',
  primaryBlue: '#17C8FF',
  secondaryBlue: '#21A8FF',
  gold: '#F4B400',
  green: '#6FD53B',
  orange: '#FF9E1B',
  red: '#FF5D5D',
  textPrimary: '#FFFFFF',
  textSecondary: '#A8B4C5',
  textDisabled: '#667381'
} as const;

export const AppSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export const AppRadius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22
} as const;

export const AppShadows = {
  soft: '0 12px 32px rgba(0,0,0,0.35)',
  medium: '0 18px 44px rgba(0,0,0,0.45)',
  blueGlow: '0 0 0 1px rgba(23,200,255,0.24), 0 10px 24px rgba(23,200,255,0.2)'
} as const;

export const AppTypography = {
  family: '"Manrope", "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "Consolas", monospace'
} as const;

export const AppIcons = {
  portfolio: 'pie_chart',
  quotations: 'candlestick_chart',
  correlations: 'shield',
  monteCarlo: 'timeline',
  backtesting: 'trending_up',
  newEtf: 'storage',
  settings: 'tune',
  rebalance: 'balance',
  macro: 'public',
  risk: 'shield'
} as const;

export const AppTheme = {
  mode: 'dark-premium',
  cardRadius: AppRadius.lg,
  animationMs: 180
} as const;
