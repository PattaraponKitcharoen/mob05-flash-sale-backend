export function getEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`CRITICAL ERROR: Environment variable ${key} is missing!`);
  }
  return value;
}

export function getEnvNumber(key: string): number {
  const value = getEnv(key);
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`CRITICAL ERROR: Environment variable ${key} must be a valid number!`);
  }
  return num;
}
