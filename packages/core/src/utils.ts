export function generateReferralCode(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return (`${timestamp}${random}`).toUpperCase().substring(0, 8);
}