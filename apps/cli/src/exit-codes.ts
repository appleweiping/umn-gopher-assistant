export const ExitCode = {
  success: 0,
  usage: 2,
  config: 3,
  auth: 4,
  permission: 5,
  unavailable: 6,
  protocol: 7,
  conflict: 8,
  internal: 9,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
