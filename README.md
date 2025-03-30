# Meme Tools

# Token Pre Launch Plan

1. Run this command to set the _production_ environment:

    ```bash
    yarn setenv:prod
    ```

2. Temporarily, set this environment variable in the _.env.production_ file:

    - `TOKEN_SYMBOL=TOKEN`

3. If needed, run this command to generate pool shares for the snipers:

    ```bash
    yarn generate-shares
    ```

4. Set these environment variables in the _.env.production_ file:

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

        - `SNIPER_POOL_SHARE_PERCENTS`
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

5. Run this command to check the configuration:

    ```bash
    yarn get-config
    ```

6. Run this command to grind the _main_ keypairs:

    ```bash
    yarn grind-keypairs
    ```

7. Run this command to estimate funds to transfer to the _main_ wallets:

    ```bash
    yarn distribute-funds:dry-run
    ```

8. Transfer the reported funds from my Phantom wallet to the _main_ wallets using [Jumper Bridge](https://jumper.exchange/?fromChain=1&fromToken=0xdAC17F958D2ee523a2206206994597C13D831ec7&toChain=1151111081099710&toToken=11111111111111111111111111111111).

9. Run this command again to make sure that all the _main_ wallets have sufficient balances:

    ```bash
    yarn distribute-funds:dry-run
    ```

10. Run these commands to distribute funds to the sniper and trader wallets:

    ```bash
    yarn distribute-funds && yarn get-funds
    ```

# Token Launch Plan

1. Find a meta using the following platforms:

    - [Discord](https://discord.com) (Tweetshift channels)
    - [Dex Screener](https://dexscreener.com/1h?rankBy=trendingScoreH1&order=desc)
    - [Dex Tools](https://www.dextools.io/app/en/trending)
    - [Defined](https://www.defined.fi/tokens/discover?createdAt=hour1&rankingBy=volume&rankingDirection=DESC)

2. Register an email on [Gmail](https://workspace.google.com/intl/en-US/gmail/).

3. Register an account on [X.com](https://x.com/i/flow/signup).

4. Create a Telegram channel.

5. Run this command to make sure that the _production_ environment is set correctly:

    ```bash
    yarn getenv
    ```

6. Create the two meme images in the webp format:

    1. A token image with a size of 200x200. Save it as the _$TOKEN_SYMBOL.wepb_ in the _images/production_ folder.

    2. A banner image with a size of 600x200. Save it as _$TOKEN_SYMBOL_banner.webp_ in the _images/production_ folder.

7. Set these environment variables in the _.env.production_ file:

    - Token:
        - `TOKEN_SYMBOL` (**Replace the _TOKEN_ value with the actual one**)
        - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
        - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
        - `TOKEN_WEBSITE_URI` (Defaults to _""_)
        - `TOKEN_TWITTER_URI` (Defaults to _""_)
        - `TOKEN_TELEGRAM_URI` (Defaults to _""_)
        - `TOKEN_TAGS` (Defaults to _"meme"_)

8. Run this command to check the configuration:

    ```bash
    yarn get-config
    ```

9. Run these commands to rename token key pair and storage files:

    ```bash
    yarn rename-token-files && yarn get-funds:main
    ```

10. Run these commands to create the token mint:

    ```bash
    yarn create-mint && yarn get-mint && yarn get-funds:main
    ```

11. Run these commands to open a Raydium CPMM pool:

    ```bash
    yarn open-pool:raydium && yarn get-pool:raydium && yarn get-funds:main
    ```

12. Lock the pool liquidity on [UNCX](https://solana.uncx.network/lockers/manage/locker) for 3 days.

13. Run this command to start trading in this pool:

    ```bash
    yarn trade:raydium
    ```

14. Fill in the forms and pay to update token information on these platforms:

- [Dex Screener](https://marketplace.dexscreener.com/product/token-info/order)
- [Dex Tools](https://www.dextools.io/marketplace/en/create-socials)

10. Check token trending on these platforms:

- [Dex Screener](https://dexscreener.com/6h?rankBy=trendingScoreH6&order=desc&chainIds=solana)
- [Dex Tools](https://www.dextools.io/app/en/solana/trending)
- [Defined](https://www.defined.fi/tokens/discover?network=sol&createdAt=hour4&rankingBy=volume&rankingDirection=DESC)

# Token Post Launch Plan

1. Adjust these environment variables in the _.env.production_ file:

    - Pool:

        - `POOL_TRADING_CYCLE_COUNT`
        - `POOL_TRADING_PUMP_BIAS_PERCENT`
        - `POOL_TRADING_ONLY_NEW_TRADERS`

    - Trader:

        - `TRADER_COUNT`

2. If the `$TRADER_COUNT` variable is adjusted up:

    1. Run this command to estimate funds to transfer to the _trader distributor_ wallet:

    ```bash
    yarn distribute-funds:dry-run
    ```

    2. Transfer the reported funds to the _trader distributor_ wallet:

    3. Run this command again to make sure that the _trader distributor_ wallet has sufficient balance:

    ```bash
    yarn distribute-funds:dry-run
    ```

    4. Run this command to distribute funds to the trader wallets:

    ```bash
    yarn distribute-funds
    ```

    5. Set `$POOL_TRADING_ONLY_NEW_TRADERS` to `true`.

3. Run this command to start trading in this pool:

    ```bash
    yarn trade:raydium
    ```

# Token Exit Plan

1. Run these commands to close the Raydium pool and to collect funds to the _main_ wallets.

    ```bash
    yarn close-pool:raydium && yarn collect-funds && yarn get-funds
    ```

2. Unlock the pool liquidity on [UNCX](https://solana.uncx.network/lockers/manage/locker) after expiring a lock period.

3. Run these commands to remove liquidity from the pool:

    ```bash
    yarn remove-liquidity:raydium
    ```

4. Run these commands to list the _main_ wallets and import their secret keys into my Phantom wallet:

    ```bash
    yarn get-accounts:main
    ```

5. Transfer the collected funds from the imported _main_ wallets to my Phantom wallet using [Jumper Bridge](https://jumper.exchange/?fromChain=1151111081099710&fromToken=11111111111111111111111111111111&toChain=1&toToken=0xdAC17F958D2ee523a2206206994597C13D831ec7).
