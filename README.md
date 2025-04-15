# Meme Tools

# Token Pre Launch Plan

1. Run this command to set the _production_ environment:

    ```bash
    yarn setenv:prod
    ```

2. Set this environment variable in the _.env.production_ file:

    - `TOKEN_SYMBOL=TOKEN`

3. If required, run this command to generate pool shares for the snipers:

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

8. Run this command to estimate how much USDC should be transferred to the _main_ accounts:

    ```bash
    yarn distribute-funds:dry-run
    ```

9. Transfer USDC from _marketing_ account on Base to the _main_ accounts on Solana using [Rhino Bridge](https://app.rhino.fi/bridge?mode=receive&chainIn=BASE&chainOut=SOLANA&token=USDC).

10. Swap the transferred USDC to SOL for each _main_ account.

11. Run this command again to make sure that all the _main_ accounts have sufficient SOL:

    ```bash
    yarn distribute-funds:dry-run
    ```

12. Run these commands to distribute funds from the _distributor_ accounts to all the _sniper_ and _trader_ accounts:

    ```bash
    yarn distribute-funds && yarn get-funds
    ```

13. Make sure that the _marketing_ wallet has at least 581 USDC on balance. The promotions are as follows:

    - 300 USDC to update the token info on [Dex Screener](https://marketplace.dexscreener.com/product/token-info/order)
    - 100 USDC to buy the 10x pack boost on [Dex Screener](https://dexscreener.com)
    - 181 USDC to promote the X account via [SocialPlug](https://panel.socialplug.io/order/twitter-nft)

14. Add 181 USDC to the account on [SocialPlug](https://panel.socialplug.io/portal/page/pg_add_funds).

# Token Launch Plan

1. Find a meta using the following platforms:

    - [Discord](https://discord.com/channels/1329183129604198490)
    - [Dex Screener](https://dexscreener.com/1h?rankBy=trendingScoreH1&order=desc)
    - [Dex Tools](https://www.dextools.io/app/en/trending)
    - [Defined](https://www.defined.fi/tokens/discover?createdAt=hour1&rankingBy=volume&rankingDirection=DESC)

2. Create these two meme images via [Midjourney](https://www.midjourney.com) and/or [ChatGPT](https://chatgpt.com):

    - The token image with the size of 200x200. Save it as the _$TOKEN_SYMBOL.jpg_ in the _images/production_ folder

    - The banner image with the size of 600x200. Save it as _$TOKEN_SYMBOL-banner.jpg_ in the _images/production_ folder

3. Optionally, create a website:

    - Register a domain via [Godaddy](https://www.godaddy.com)

    - Create the website via [Hodl.fyi](https://hodl.fyi)

    - Connect this website to the registered domain

4. Create these social channels:

    - Create an email on [Adguard](https://adguard.com/en/adguard-temp-mail/overview.html), if the website is not created

    - Create an account on [X.com](https://x.com/i/flow/signup). Use either an Adguard or Godaddy email for it

    - Create a Telegram public group

5. Run this command to make sure that the _production_ environment is set correctly:

    ```bash
    yarn getenv
    ```

6. Set these environment variables in the _.env.production_ file:

    - Token:
        - `TOKEN_SYMBOL` (**Replace the _TOKEN_ value with the actual one**)
        - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
        - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
        - `TOKEN_WEBSITE_URI` (Defaults to _""_)
        - `TOKEN_TWITTER_URI` (Set it to the Twitter URI created on step 2.2)
        - `TOKEN_TELEGRAM_URI` (Set it to the Telegram URI created on step 2.3)
        - `TOKEN_TAGS` (Defaults to _"meme"_)

7. Run this command to check the current configuration:

    ```bash
    yarn get-config
    ```

8. Run these commands to rename the key pair and storage files for the token:

    ```bash
    yarn rename-token-files && yarn get-funds:main
    ```

9. Run these commands to create the token mint:

    ```bash
    yarn create-mint && yarn get-mint && yarn get-funds:main
    ```

10. Order the following promotions for the X account on [SocialPlug](https://panel.socialplug.io/order/twitter-nft):

    - 100 Followers

11. Order the following promotions for the Telegram channel on [SocialPlug](https://panel.socialplug.io/order/telegram):

    - 100 Subscribers

12. Run this command to open a Raydium CPMM pool:

    ```bash
    yarn open-pool:raydium
    ```

13. Shortly after the previous step, run these commands to burn liquidity in this pool:

    ```bash
    yarn burn-liquidity:raydium && yarn get-pool:raydium && yarn get-funds:main
    ```

14. Publish posts about the token launch on the X account and the Telegram group.

15. Run this command to generate comments for the previously published X post:

    ```bash
    yarn get-comments:twitter
    ```

16. Order the following promotions for the previously published X post on [SocialPlug](https://panel.socialplug.io/order/twitter-nft):

    - 200 Likes
    - 200 Retweets
    - 30 Comments
    - 30 Quote Tweets

17. Add the contract address to the website if any.

18. Update the token information on [Dex Screener](https://marketplace.dexscreener.com/product/token-info/order), publish posts about it on the X account and the Telegram group, and order the _200 Likes_ promotion for the published X post on [SocialPlug](https://panel.socialplug.io/order/twitter-nft).

19. Buy the boost 10x pack on [Dex Screener](https://dexscreener.com), publish posts about it on the X account and the Telegram group, and order the _200 Likes_ promotion for the published X post on [SocialPlug](https://panel.socialplug.io/order/twitter-nft).

20. Order the _500 Dex Screener reactions_ promotion on [Fiverr](https://www.fiverr.com/seo_roy2/do-increase-and-boost-react-for-your-dexscreener).

21. Run this command to trade in this pool:

    ```bash
    yarn trade:raydium
    ```

22. Monitor token trending on these platforms:

- [Dex Screener](https://dexscreener.com/6h?rankBy=trendingScoreH6&order=desc&chainIds=solana&boosted=1&profile=1)
- [Dex Tools](https://www.dextools.io/app/en/solana/trending)
- [Defined](https://www.defined.fi/tokens/discover?network=sol&createdAt=hour4&rankingBy=volume&rankingDirection=DESC)

# Token Post Launch Plan

1. Publish posts about the meme on the X account and the Telegram group.

2. Publish posts about reaching 500 Dex Screener reactions on the X account and the Telegram group, and raid it on the Telegram group.

3. If opt in, adjust these environment variables in the _.env.production_ file:

    - Pool:

        - `POOL_TRADING_CYCLE_COUNT`
        - `POOL_TRADING_PUMP_BIAS_PERCENT`
        - `POOL_TRADING_ONLY_NEW_TRADERS`

    - Trader:

        - `TRADER_COUNT`

4. If the `$TRADER_COUNT` variable is adjusted up:

    1. Run this command to estimate USDC to transfer to the _trader distributor_ account:

    ```bash
    yarn distribute-funds:dry-run
    ```

    2. Transfer USDC from the _marketing_ account to the _trader distributor_ account.

    3. Run this command again to make sure that the _trader distributor_ account has sufficient balance:

    ```bash
    yarn distribute-funds:dry-run
    ```

    4. Run this command to distribute funds to the new _trader_ accounts:

    ```bash
    yarn distribute-funds
    ```

    5. Set `$POOL_TRADING_ONLY_NEW_TRADERS` to `true`.

5. Run this command to trade in this pool:

    ```bash
    yarn trade:raydium
    ```

6. Optionally, update the token information on [Dex Tools](https://www.dextools.io/marketplace/en/create-socials), publish posts about it on the X account and the Telegram group, and raid it on the Telegram group.

7. Optionally, buy another boost 10x pack on [Dex Screener](https://dexscreener.com) after the expiration of the original one, publish posts about it on the X account and the Telegram group, and raid it on the Telegram group.

# Token Exit Plan

1. Run this command to close the Raydium pool.

    ```bash
    yarn close-pool:raydium
    ```

2. Run these commands to collect funds on the _main_ accounts.

    ```bash
    yarn collect-funds && yarn get-funds
    ```

3. Transfer the SOL from the _main_ accounts to the _marketing_ account.

4. Swap the transferred SOL to USDC on the _marketing_ account.

5. Transfer the swapped USDC from the _marketing_ account on Solana to the _marketing_ account on Base using [Rhino Bridge](https://app.rhino.fi/bridge?mode=receive&chainIn=SOLANA&chainOut=BASE&token=USDC).
