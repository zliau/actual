import express from 'express';

import { handleError } from './app-gocardless/util/handle-error.js';
import { SecretName, secretsService } from './services/secrets-service.js';
import { requestLoggerMiddleware } from './util/middlewares.js';

const app = express();
export { app as handlers };
app.use(express.json());
app.use(requestLoggerMiddleware);

// Exchange Rate API configuration
const EXCHANGE_RATE_API_BASE_URL = 'https://openexchangerates.org/api';

app.post(
  '/fetch',
  handleError(async (req, res) => {
    const { fromCurrency, toCurrency, date } = req.body || {};

    // Validate required parameters
    if (!fromCurrency || !toCurrency || !date) {
      res.status(400).send({
        status: 'error',
        error: 'Missing required parameters: fromCurrency, toCurrency, date',
      });
      return;
    }

    // Get API key from secrets service
    const apiKey = secretsService.get(SecretName.exchange_rate_api_key);
    
    if (apiKey == null || apiKey === 'Forbidden') {
      res.status(403).send({
        status: 'error',
        error: 'Exchange rate API key not configured',
      });
      return;
    }

    try {
      // Fetch exchange rate from OpenExchangeRates API
      const url = `${EXCHANGE_RATE_API_BASE_URL}/historical/${date}.json?app_id=${apiKey}&base=${fromCurrency}&symbols=${toCurrency}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Exchange rate API error: ${response.status} ${response.statusText}`);
      }
      console.log('response', response);
      
      const data = await response.json();
      
      if (!data.rates || !data.rates[toCurrency]) {
        throw new Error('Invalid response from exchange rate API');
      }
      
      const rate = data.rates[toCurrency];
      
      res.send({
        status: 'ok',
        data: {
          fromCurrency,
          toCurrency,
          date,
          rate,
          source: 'openexchangerates',
        },
      });
    } catch (error) {
      console.error('Failed to fetch exchange rate:', error);
      res.status(500).send({
        status: 'error',
        error: 'Failed to fetch exchange rate',
      });
    }
  }),
);

app.post(
  '/status',
  handleError(async (req, res) => {
    const apiKey = secretsService.get(SecretName.exchange_rate_api_key);
    const configured = apiKey != null && apiKey !== 'Forbidden';

    res.send({
      status: 'ok',
      data: {
        configured,
      },
    });
  }),
); 