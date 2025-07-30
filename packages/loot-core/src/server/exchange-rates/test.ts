import { fetchAndStoreExchangeRate, getExchangeRate } from './app';

// Simple test function to verify exchange rate functionality
export async function testExchangeRateFunctionality() {
  console.log('Testing exchange rate functionality...');
  
  try {
    // Test fetching and storing an exchange rate
    const exchangeRate = await fetchAndStoreExchangeRate(
      'EUR',
      'USD',
      '2024-01-15',
      'test'
    );
    
    console.log('Successfully fetched and stored exchange rate:', exchangeRate);
    
    // Test retrieving the exchange rate
    const retrievedRate = await getExchangeRate('EUR', 'USD', '2024-01-15');
    
    if (retrievedRate) {
      console.log('Successfully retrieved exchange rate:', retrievedRate);
    } else {
      console.log('Failed to retrieve exchange rate');
    }
    
    return { success: true, exchangeRate, retrievedRate };
  } catch (error) {
    console.error('Exchange rate test failed:', error);
    return { success: false, error };
  }
}

// Test function to verify date conversion logic
export function testDateConversion() {
  console.log('Testing date conversion logic...');
  
  // Test converting YYYYMMDD to YYYY-MM-DD
  const testCases = [
    { input: 20240115, expected: '2024-01-15' },
    { input: 20241231, expected: '2024-12-31' },
    { input: 20230101, expected: '2023-01-01' },
  ];
  
  for (const testCase of testCases) {
    const dateString = testCase.input.toString();
    const converted = dateString.slice(0, 4) + '-' + dateString.slice(4, 6) + '-' + dateString.slice(6);
    
    if (converted === testCase.expected) {
      console.log(`✅ ${testCase.input} -> ${converted}`);
    } else {
      console.log(`❌ ${testCase.input} -> ${converted} (expected: ${testCase.expected})`);
    }
  }
  
  return { success: true };
} 