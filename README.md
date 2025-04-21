# Meme Tools Plan

# Funding Phase

1. Run this command to set the _production_ environment:

    ```bash
    yarn setenv:prod
    ```

2. Set this environment variable in the _.env.production_ file:

    - `TOKEN_SYMBOL=TOKEN`

3. Optionally, run this command to generate pool shares for the snipers:

    ```bash
    yarn generate-shares
    ```

4. Optionally, set the following environment variables in the _.env.production_ file:

    - Common:

        - `LOG_LEVEL`
        - `PINATA_JWT`
        - `IPFS_GATEWAY_URI`
        - `RPC_URIS`
        - `EXPLORER_URI`
        - `KEYPAIR_ENCRYPTION_SECRET`

    - Token:

        - `TOKEN_DECIMALS` (Defaults to _6_)
        - `TOKEN_SUPPLY` (Defaults to _1 billion_)

    - Pool:

        - `POOL_SIZE_PERCENT` (Defaults to _100_)
        - `POOL_LIQUIDITY_SOL`
        - `POOL_TRADING_CYCLE_COUNT`
        - `POOL_TRADING_PUMP_BIAS_PERCENT` (Defaults to _50_)
        - `POOL_TRADING_ONLY_NEW_TRADERS` (Defaults to _false_)

    - Sniper:

        - `SNIPER_POOL_SHARE_RANGE_PERCENT`
        - `SNIPER_BALANCE_SOL`
        - `SNIPER_REPEATABLE_BUY_PERCENT` (Defaults to _0_)
        - `SNIPER_REPEATABLE_SELL_PERCENT` (Defaults to _0_)
        - `SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL` (Defaults to _[0, 0]_)
        - `SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT` (Defaults to _[0, 0]_)

    - Trader:

        - `TRADER_COUNT`
        - `TRADER_BALANCE_SOL`
        - `TRADER_BUY_AMOUNT_RANGE_SOL`
        - `TRADER_SELL_AMOUNT_RANGE_PERCENT`

    - Swapper:
        - `SWAPPER_GROUP_SIZE` (Defaults to _1_)
        - `SWAPPER_TRADE_DELAY_RANGE_SEC`

5. Run this command to check the current configuration:

    ```bash
    yarn get-config
    ```

6. Run this command to grind the _main_ keypairs:

    ```bash
    yarn grind-keypairs
    ```

7. Run these commands to list the _main_ accounts and import their secret keys into the _Phantom_ wallet on Solana:

    ```bash
    yarn get-accounts:main
    ```

8. Run this command to estimate how much USD should be transferred to the _main_ accounts:

    ```bash
    yarn distribute-funds:dry-run
    ```

9. Transfer USDC from _collector_ account on Base to the _dev_ and _sniper distributor_ accounts on Solana using [Rhino Bridge](https://app.rhino.fi/bridge?mode=receive&chainIn=BASE&chainOut=SOLANA&token=USDC).

10. Swap the transferred USDC to SOL for the _dev_ and _sniper distributor_ accounts.

11. Transfer SOL from _collector_ account to the _trader distributor_ account.

12. Run this command again to make sure that all the _main_ accounts have sufficient SOL:

    ```bash
    yarn distribute-funds:dry-run
    ```

13. Run these commands to distribute funds from the _distributor_ accounts to all the _sniper_ and _trader_ accounts:

    ```bash
    yarn distribute-funds && yarn get-funds
    ```

14. Make sure that the _collector_ account has at least 400 USDC budget.

15. Make sure that the account on [Graming](https://graming.com/usd/) is topped up with at least 20 USD.

# Token Pre Launch Phase

1. Find a meta using the following platforms:

    - [Discord](https://discord.com/channels/1329183129604198490)
    - [Dex Screener](https://dexscreener.com/1h?rankBy=trendingScoreH1&order=desc)
    - [Dex Tools](https://www.dextools.io/app/en/trending)
    - [Defined](https://www.defined.fi/tokens/discover?createdAt=hour1&rankingBy=volume&rankingDirection=DESC)

2. Create these two meme images via [Midjourney](https://www.midjourney.com) and/or [ChatGPT](https://chatgpt.com):

    - The token image with the size of 200x200. Save it as the _$TOKEN_SYMBOL.jpg_ in the _images/production_ folder

    - The banner image with the size of 600x200. Save it as _$TOKEN_SYMBOL-banner.jpg_ in the _images/production_ folder

3. Run this command to make sure that the _production_ environment is set correctly:

    ```bash
    yarn getenv
    ```

4. Set these environment variables in the _.env.production_ file:

    - Token:
        - `TOKEN_SYMBOL` (**Replace the _TOKEN_ value with the actual one**)
        - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
        - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
        - `TOKEN_WEBSITE_URI` (Defaults to _""_)
        - `TOKEN_TWITTER_URI` (Set it to the Twitter URI created on step 2.2)
        - `TOKEN_TELEGRAM_URI` (Set it to the Telegram URI created on step 2.3)
        - `TOKEN_TAGS` (Defaults to _"meme"_)

5. Run this command to check the current configuration:

    ```bash
    yarn get-config
    ```

6. Create the social channels:

    - Create the email on [Adguard](https://adguard.com/en/adguard-temp-mail/overview.html)

    - Create an account on [X.com](https://x.com/i/flow/signup) using the email from the previous step

    - Set up the X.com profile

    - Create a public channel and a private group on [Telegram](https://telegram.org) protected with [Safeguard bot](https://t.me/Safeguard)

    - Set up the Telegram channel and group

7. Run these commands to rename the key pair and storage files for the token:

    ```bash
    yarn rename-token-files && yarn get-funds:main
    ```

# Token Launch Phase

1. Run these commands to create the token mint:

    ```bash
    yarn create-mint && yarn get-mint && yarn get-funds:main
    ```

2. Add the token address to the X account and the Telegram account

3. Order the following promotions for the X account:

    - 500 Followers (9.50 USD) on [Graming](https://graming.com/buy-twitter-x-followers/)

4. Start social hype about the token launch:

    - Publish and pin posts about the meme description

    - Publish and pin posts about the meme launch on the X account and the Telegram group

5. Run this command to open a Raydium CPMM pool:

    ```bash
    yarn open-pool:raydium
    ```

6. Shortly after the previous step, run these commands to burn liquidity in this pool:

    ```bash
    yarn burn-liquidity:raydium && yarn get-pool:raydium && yarn get-funds:main
    ```

7. Start social hype about the token information update on Dex Screener:

    - Update the token information for 299 USD on [Dex Screener](https://marketplace.dexscreener.com/product/token-info/order)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

8. Start social hype about the token boost on Dex Screener:

    - Buy the boost 10x pack for 99 USD on [Dex Screener](https://dexscreener.com)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

9. Order the following promotion on [Fiverr](https://www.fiverr.com/seo_roy2/do-increase-and-boost-react-for-your-dexscreener):

    - _500 Dex Screener reactions_ (10 USD)

10. Run this command to trade in this pool:

    ```bash
    yarn trade:raydium
    ```

11. Monitor token trending on these platforms:

- [Dex Screener](https://dexscreener.com/6h?rankBy=trendingScoreH6&order=desc&chainIds=solana&boosted=1&profile=1)
- [Dex Tools](https://www.dextools.io/app/en/solana/trending)
- [Defined](https://www.defined.fi/tokens/discover?network=sol&createdAt=hour4&rankingBy=volume&rankingDirection=DESC)

# Token Post Launch Phase

1. Start social hype about reaching 500 reactions on Dex Screener:

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

2. Optionally, adjust these environment variables in the _.env.production_ file:

    - Pool:

        - `POOL_TRADING_CYCLE_COUNT`
        - `POOL_TRADING_PUMP_BIAS_PERCENT`
        - `POOL_TRADING_ONLY_NEW_TRADERS`

    - Trader:

        - `TRADER_COUNT`

    - Swapper:
        - `SWAPPER_TRADE_DELAY_RANGE_SEC`

3. If the `$TRADER_COUNT` variable is adjusted up:

    - Run this command to estimate USD to transfer to the _trader distributor_ account:

    ```bash
    yarn distribute-funds:dry-run
    ```

    - Transfer USD from the _collector_ account to the _trader distributor_ account.

    - Run this command again to make sure that the _trader distributor_ account has sufficient balance:

    ```bash
    yarn distribute-funds:dry-run
    ```

    - Run this command to distribute funds to the new _trader_ accounts:

    ```bash
    yarn distribute-funds
    ```

    - Set `$POOL_TRADING_ONLY_NEW_TRADERS` to `true`.

4. Run this command to trade in this pool:

    ```bash
    yarn trade:raydium
    ```

5. Optionally, start social hype about the token information update on Dex Screener:

    - Update the token information for 295 USD on [Dex Tools](https://www.dextools.io/marketplace/en/create-socials)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

6. Optionally, start social hype about another token boost on Dex Screener:

    - Buy the boost 10x pack for 99 USD on [Dex Screener](https://dexscreener.com)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

# Token Exit Phase

1. Run this command to close the Raydium pool:

    ```bash
    yarn close-pool:raydium
    ```

2. Run these commands to collect funds on the _main_ accounts:

    ```bash
    yarn collect-funds && yarn get-funds
    ```

3. Transfer the SOL from the _main_ accounts to the _collector_ account.

4. Swap some transferred SOL to USDC on the _collector_ account.

5. Transfer the swapped USDC from the _collector_ account on Solana to the _collector_ account on Base using [Rhino Bridge](https://app.rhino.fi/bridge?mode=receive&chainIn=SOLANA&chainOut=BASE&token=USDC).
