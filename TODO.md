### Multi Currency
1. budget should have a base currency
2. account should have a selectable currency (cannot be changed)
   a. If currency is not selected, default to base currency
3. pull exchange rate from the API
4. currency should not be converted for individual transactions in the account view
5. showing value of account should have the currency converted
6. budgeting should have the currency converted for individual transactions

## TODO
- what about synced accounts? pull the currency info from the integration

## Fetch currency from API

Times to import the rates
- button to sync rates for a specific account/all accounts
  - fetches rates for those date ranges
- when importing, we should calculate the date ranges and then pull from the API for that currency
- daily? when next login we should fetch the rates from the last login

## Amount vs converted_amount
- maybe what we should do is to store the converted amount into the amount field always
- then all queries will display the right value
- we can store the "account currency amount" in a new field
- this way we minimize the work for all budgeting, just need to modify the transaction list to display the correct value?
- need to handle the case where transfers are of different values because the exchange rate is wrong between the time it leaaves the account and the time it posts in the new account

