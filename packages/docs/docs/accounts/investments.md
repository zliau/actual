# Investment Accounts

An investment account tracks the stocks and funds you hold. It lists what you bought and sold, fetches daily closing prices, and shows what your holdings are worth and how much you have gained or lost. The account's balance includes that value, so your net worth follows the market.

Investment accounts are always off budget, so nothing in them affects your budget.

## What Is Supported

- Stocks and funds listed in the US, in US dollars.
- Stocks listed on the Toronto Stock Exchange, in Canadian dollars.

Each investment account uses one currency. If your brokerage holds both, create one account for each currency, and put them in the same account group to see them together.

If your main currency is different from the account's, the balance is converted to your main currency in totals using your [exchange rates](../budgeting/multi-currency.md).

## Creating an Investment Account

1. Click **Add account** at the bottom of the sidebar. If you use a server, choose **Create a local account**.
2. Enter a name, and check **Investment account**.
3. Choose **US Dollar** or **Canadian Dollar**.
4. Under **Starting cash**, enter the cash the account holds now. If you are about to enter your past trades, enter the cash from before the first one instead.
5. Click **Create**.

The account page now shows a **Holdings** table above the transactions.

## Recording Trades

To record a trade:

1. Click **Add trade**.
2. Choose **Buy** or **Sell**, and the date.
3. Enter the symbol, like `AAPL`. If you have set up price updates, enter a symbol or company name and click **Find symbol** to search.
4. Enter the number of shares, which can be a fraction, the price per share and any fee.
5. Click **Save**.

If you have set up price updates, Actual fills in the price for you once you have entered the symbol and date. It uses that day's closing price, or the last closing price before it on a weekend or holiday, and shows the day it came from below the price. The closing price is usually a little different from the price you paid, so type over it with the price from your broker if you want an exact match. To get the closing price back, clear the price.

To change or delete a trade, click the holding in the table and then click the trade.

Each trade moves the account's cash. Buying 10 shares at $100 with a $5 fee takes $1,005 out of the cash, and selling takes the proceeds less the fee in.

:::note
Money moving into the account is an ordinary [transfer](../transactions/transfers.md) from your bank account. Record those too, or the cash shown in the account goes negative when you buy.
:::

### Stock You Receive as Pay

If your employer pays you in shares, such as RSUs, record each vest as a trade:

1. Click **Add trade** and choose **Vest**.
2. Enter the vest date and the symbol.
3. Under **Vested**, enter all the shares that vested. Under **Withheld**, enter any shares your employer held back for tax.
4. Enter the price on the vest date. Your vest statement shows it, and if you have set up price updates, Actual fills in that day's closing price.
5. Click **Save**.

Only the shares that reach your account are added, and no cash leaves the account. Their cost is the price on the vest date, which is also what your gain or loss is worked out from when you sell. Below the fields, Actual shows the shares you received, the pay the vest is worth, and how much of that was withheld for tax.

Shares you receive as pay don't affect your budget until you sell them and move the cash to a budget account, since you can't spend them before then. Shares that haven't vested yet aren't yours, so don't record them until they vest.

### Dividends

To record a dividend a stock paid you:

1. Click **Add trade** and choose **Dividend**.
2. Enter the date it was paid and the symbol.
3. Under **Amount**, enter the cash you received.
4. Click **Save**.

The dividend adds its cash to the account, and it counts toward the stock's return in the investment performance report. Click the holding to see its dividends with its trades.

If you have already entered dividends as deposits, delete them and record them as dividends instead, so that they count toward the stock's return.

### Moving Shares Between Accounts

When shares move from one of your accounts to another, such as from your employer's stock plan to your own brokerage, record the move instead of a sell and a buy. A sell and a buy would count a gain you didn't make and lose what the shares cost you.

To move shares:

1. Open the account the shares are leaving, click **Add trade** and choose **Move to another account**.
2. Under **To**, choose the account the shares are going to. It needs to be another investment account in the same currency.
3. Enter the date, the symbol and the number of shares.
4. Enter the price per share on that day. Actual fills in that day's closing price if you have set up price updates. The price is only used to value the shares in each account, and doesn't change what they cost.
5. Click **Save**.

The shares leave the first account and arrive in the other, which shows them in its Holdings table at the same average cost. No cash moves. If you later change a trade from before the move in the first account, the cost in the other account follows.

To change or delete a move, click the holding in either account and then click the move. Changing or deleting it changes or deletes both sides.

## Reading the Holdings Table

| Column          | What It Shows                                                        |
| --------------- | -------------------------------------------------------------------- |
| Shares          | How many shares you hold.                                            |
| Average cost    | What you paid per share on average, including fees.                  |
| Price           | The price used to value the holding.                                 |
| Price date      | The day of that price.                                               |
| Value           | Shares multiplied by price.                                          |
| Unrealized gain | The value less what the shares you still hold cost you.              |
| Realized gain   | What you have made or lost on the shares you sold, after their cost. |

Gains use the average cost. When you sell, the shares you sold count at the average cost at that time, and the average cost of the remaining shares stays the same.

Holdings you have sold completely stay at the bottom of the table so that you can still see their realized gain.

## Prices

The price used is the latest closing price Actual has. If you have traded the stock more recently than that, the price of your latest trade is used instead.

### Setting Up Price Updates

Fetching prices needs a [sync server](../config/index.md). Prices come from:

- [Tiingo](https://www.tiingo.com/account/api/token) for US stocks and funds, which needs a free key.
- Yahoo Finance for Toronto stocks, which needs no key.

To add a Tiingo key:

1. Open an investment account and click **Set up price updates**.
2. Paste the key and click **Save**.

The key is stored on your server and applies to all the budgets on it, so it can only be set by an administrator of the server. Tiingo offers its free keys for personal use, so check its terms if others use your server.

Actual then fetches closing prices when you open a budget and every hour while it stays open. To fetch them right away, click **Update prices**.

:::note
Yahoo Finance doesn't offer its prices officially, so Toronto prices may stop updating at any time. If they do, enter prices yourself, and enter Toronto splits yourself too.
:::

### Entering Prices by Hand

You can always enter prices yourself, with or without a server. Click the holding, then click **Add price**. A price you enter is not replaced by a fetched one for the same day.

## Stock Splits

A split changes how many shares you hold but not what you paid for them in total. A split applies to every account holding the stock.

Actual shows a message when a split is reported for something you hold. The holding's value may be wrong until you apply or ignore the split, so check it against your broker, then click **Apply split** or **Ignore**.

If a split isn't reported, or prices aren't set up, enter it yourself:

1. Click the holding, then click **Add split**.
2. Choose the first day the shares traded at the new price.
3. Enter the new and old shares. A 4-for-1 split is 4 new shares for 1 old share, and a 1-for-10 reverse split is 1 new share for 10 old shares.
4. Click **Save**.

:::caution
Enter trades using the number of shares and the price you had at the time. Actual applies the split to your earlier shares itself.
:::

## How the Balance Works

The account's balance is its cash plus the value of its holdings. To make that work, Actual adds two kinds of transactions next to the ones that move cash:

- A **Shares in** or **Shares out** transaction on the day of each trade that moves shares, holding what those shares were worth at the trade's price, like `Shares in: 10 AAPL @ 100`. A buy takes cash out and brings shares of the same value in, so the balance only changes by the fee.
- A **Market value** transaction for each stock every month, holding what price changes did to that stock's value over the month. Its notes say which stock it is for and what you held at the end of the month, like `Market value 10 AAPL @ 120`, or `Market value AAPL, sold` in the month you sold the last of it.

Actual updates these transactions whenever a trade or price changes.

This means that:

- The sidebar, account groups and the net worth report all include your holdings.
- Reports of income and spending leave out trades and market value transactions.
- Past balances are accurate on the day of each trade and at the end of each month. Price changes within a past month only show at its end.

Shares, market value and trade transactions are written by Actual, so they can't be edited in the transaction list. Change the trade or price they come from instead.

An investment account can only be closed once you have sold everything it holds or moved it to another account, so that only cash moves out. Force closing it instead deletes the account and all its transactions.
