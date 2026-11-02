import type { SecurityProviderFailure } from '@actual-app/core/types/models';
import { t } from 'i18next';

// What went wrong when asking for prices or symbols, and what to do about it
export function getSecurityProviderMessage(reason: string): string {
  switch (reason as SecurityProviderFailure) {
    case 'not-configured':
      return t('Set up price updates to do this.');
    case 'invalid-key':
      return t(
        "The price service didn't accept the key. Check it in Set up price updates.",
      );
    case 'rate-limited':
      return t("The price service's limit has been reached. Try again later.");
    case 'unknown-symbol':
      return t('No stock was found with that symbol.');
    default:
      return t("Prices aren't available right now. Try again later.");
  }
}
