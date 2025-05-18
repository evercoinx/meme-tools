# Meme Tools Plan

# Funding Phase

1. Run this command to set the _production_ environment:

    ```bash
    yarn set-env:prod
    ```

2. Set this environment variable in the _.env.production_ file:

    - Token:

        - `TOKEN_SYMBOL=TOKEN`

3. Optionally, adjust the following environment variables in the _.env.production_ file:

    - General:

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

    - Collector:

        - `COLLECTOR_PUBLIC_KEY`

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

    - Whale:

        - `WHALE_AMOUNTS_SOL`
        - `WHALE_BALANCE_SOL`

    - Swapper:

        - `SWAPPER_GROUP_SIZE` (Defaults to _1_)
        - `SWAPPER_TRADE_DELAY_RANGE_SEC`

4. Run this command to check the current configuration:

    ```bash
    yarn get-config
    ```

5. Run this command to grind the _main_ keypairs:

    ```bash
    yarn grind-keypairs
    ```

6. Run this command to estimate how much SOL should be transferred to the _main_ accounts:

    ```bash
    yarn distribute-funds:dry-run
    ```

7. Transfer the reported SOL (the _dev_ account) from the _collector_ account on Solana to the _one_ on Base via [Mayan Bridge](https://swap.mayan.finance).

8. For a non production environment, transfer SOL from the _collector_ account on Base to the _dev_ account on Solana via [Mayan Bridge](https://swap.mayan.finance).

    ```bash
    yarn transfer-funds
    ```

9. Run this command to transfer SOL from the _collector_ account to the _sniper distributor_, _trader distributor_ and _whale distributor_ accounts.

10. Run this command to make sure that all the _main_ accounts have the sufficient SOL balances:

    ```bash
    yarn distribute-funds:dry-run
    ```

11. Run these commands to distribute funds from the _distributor_ accounts to all the _sniper_, _trader_ and _whale_ accounts:

    ```bash
    yarn distribute-funds && yarn get-funds
    ```

12. Check that the _collector_ account has the balance of at least 800 USDC. If not, swap SOL to top it up with the missing USDC.

# Token Pre Launch Phase

1. Discover meta using the following platforms:

    - [Discord](https://discord.com/channels/1329183129604198490)
    - [Dex Screener](https://dexscreener.com/1h?rankBy=trendingScoreH1&order=desc)
    - [Dex Tools](https://www.dextools.io/app/en/trending)

2. Create the following meme images via [Midjourney](https://www.midjourney.com) and/or [ChatGPT](https://chatgpt.com):

    - The token image with the size of 200x200. Save it as the _$TOKEN_SYMBOL.jpg_ in the _images/production_ folder

    - The banner image with the size of 600x200. Save it as _$TOKEN_SYMBOL-banner.jpg_ in the _images/production_ folder

3. Run this command to make sure that the _production_ environment is set:

    ```bash
    yarn get-env
    ```

4. Set the following environment variables in the _.env.production_ file:

    - Token:

        - `TOKEN_SYMBOL` (**Replace the _TOKEN_ value with the actual one**)
        - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
        - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
        - `TOKEN_WEBSITE_URI` (Defaults to _""_)
        - `TOKEN_TWITTER_URI`
        - `TOKEN_TELEGRAM_URI`
        - `TOKEN_TAGS` (Defaults to _"meme"_)

5. Run this command to check the current configuration:

    ```bash
    yarn get-config
    ```

6. Run these commands to rename the key pair and storage files for the token:

    ```bash
    yarn rename-token-files && yarn get-funds:main
    ```

7. Create the following social media channels:

    - Create a temporary email on [Adguard](https://adguard.com/en/adguard-temp-mail/overview.html)

    - Create an account on [X.com](https://x.com/i/flow/signup) using that temporary email

    - Create a public channel and a private group on [Telegram](https://telegram.org) protected with [Safeguard bot](https://t.me/Safeguard)

8. Set up the social media channels:

    - The X.com profile (avatar, wallpaper, description, a greeting post etc)

    - The Telegram channel and group (configuration, bots, a greeting message etc)

# Token Launch Phase

1. Run these commands to create the token mint:

    ```bash
    yarn create-mint && yarn get-mint && yarn get-funds:main
    ```

2. Add the token mint address to the X profile and the Telegram greeting message.

3. Run this command to open a Raydium CPMM pool:

    ```bash
    yarn open-pool:raydium
    ```

4. Shortly after the previous step, run these commands to burn liquidity in this pool:

    ```bash
    yarn burn-liquidity:raydium && yarn get-pool:raydium && yarn get-funds:main
    ```

5. Publish and pin posts about the token launch on the X account and the Telegram group.

6. Update the token information on Dex Screener:

    - Update the token information for 299 USDC on [Dex Screener](https://marketplace.dexscreener.com/product/token-info/order)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

7. Run this command to trade in the liquidity pool:

    ```bash
    yarn trade:raydium
    ```

# Token Post Launch Phase (Day 1)

1. Optionally, adjust the following environment variables in the _.env.production_ file:

    - Pool:

        - `POOL_TRADING_CYCLE_COUNT`
        - `POOL_TRADING_PUMP_BIAS_PERCENT`
        - `POOL_TRADING_ONLY_NEW_TRADERS`

    - Trader:

        - `TRADER_COUNT`

    - Swapper:

        - `SWAPPER_TRADE_DELAY_RANGE_SEC`

2. Run this command to trade in the liquidity pool:

    ```bash
    yarn trade:raydium
    ```

3. Promote the token with Telegram channels and X.com influencers:

    - Pay for the token promotion on public Telegram channels and X influencer accounts

    - Publish and pin posts on the X account and the Telegram group after publishing it

    - Raid it on the Telegram group after publishing it

4. Run these commands to whale trade in the liquidity pool occasionally:

    ```bash
    yarn buy-mint:whale1
    yarn buy-mint:whale2
    yarn buy-mint:whale3
    yarn buy-mint:whale4
    yarn buy-mint:whale5
    ```

    and

    ```bash
    yarn sell-mint:whale1
    yarn sell-mint:whale2
    yarn sell-mint:whale3
    yarn sell-mint:whale4
    yarn sell-mint:whale5
    ```

5. Boost the token on Dex Screener:

    - Buy the boost 10x pack for 99 USDC on [Dex Screener](https://dexscreener.com)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

6. Promote the token on public Telegram groups.

7. If the `$TRADER_COUNT` variable is adjusted up:

    - Run this command to estimate SOL to transfer to the _trader distributor_ account:

        ```bash
        yarn distribute-funds:dry-run
        ```

    - Transfer the reported SOL from the _collector_ account to the _trader distributor_ account

    - Run this command to make sure that the _trader distributor_ account has the sufficient SOL balance:

        ```bash
        yarn distribute-funds:dry-run
        ```

    - Run this command to distribute funds to the new _trader_ accounts:

        ```bash
        yarn distribute-funds
        ```

    - Set `$POOL_TRADING_ONLY_NEW_TRADERS` to `true`

    - Run this command to trade in the liquidity pool:

        ```bash
        yarn trade:raydium
        ```

8. Monitor the token trending on the following platforms:

- [Dex Screener](https://dexscreener.com/6h?rankBy=trendingScoreH6&order=desc&chainIds=solana&boosted=1&profile=1)
- [Dex Tools](https://www.dextools.io/app/en/solana/trending)

# Token Post Launch Phase (Day 2)

1. Reach 500 reactions on Dex Screener:

    - Order the _500 Dex Screener reactions_ promotion for 10 USD on [Fiverr](https://www.fiverr.com/seo_roy2/do-increase-and-boost-react-for-your-dexscreener)

    - Publish and pin posts on the X account and the Telegram group after reaching it

    - Raid it on the Telegram group after reaching it

2. Reach 500 followers on the X account:

    - Order the 500 Followers promotion for 9.50 USDC on [Graming](https://graming.com/buy-twitter-x-followers/)

    - Publish and pin posts on the X account and the Telegram group after reaching it

    - Raid it on the Telegram group after reaching it

3. Update the token information on Dex Tools:

    - Update the token information for 295 USDC on [Dex Tools](https://www.dextools.io/marketplace/en/create-socials)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

4. Boost the token on Dex Screener:

    - Buy the boost 30x pack for 199 USDC on [Dex Screener](https://dexscreener.com)

    - Publish and pin posts on the X account and the Telegram group

    - Raid it on the Telegram group

# Token Exit Phase

1. Run this command to close the Raydium pool:

    ```bash
    yarn close-pool:raydium
    ```

2. Run these commands to collect funds on the _main_ accounts and to transfer them to the _collector_ account:

    ```bash
    yarn collect-funds && yarn get-funds
    ```
