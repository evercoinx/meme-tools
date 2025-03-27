# Meme Tools

# Token Pre Launch Plan

1. Run `yarn setenv:prod` to set the _production_ environment.

2. Temporarily, set this environment variable in the _.env.production_ file like:

    - `TOKEN_SYMBOL=TOKEN`

3. If needed, run `yarn generate-shares` to generate pool shares for the snipers.

4. Set these environment variables in the _.env.production_ file:

    - `LOG_LEVEL`
    - `PINATA_JWT`
    - `IPFS_GATEWAY_URI`
    - `RPC_URIS`
    - `EXPLORER_URI`
    - `KEYPAIR_ENCRYPTION_SECRET`
    - `TOKEN_DECIMALS` (Defaults to _6_)
    - `TOKEN_SUPPLY` (Defaults to _1 billion_)
    - `POOL_SIZE_PERCENT` (Defaults to _100_)
    - `POOL_LIQUIDITY_SOL`
    - `POOL_TRADING_CYCLE_COUNT`
    - `POOL_TRADING_PUMP_BIAS_PERCENT` (Defaults to _50_)
    - `SNIPER_POOL_SHARE_PERCENTS`
    - `SNIPER_BALANCE_SOL`
    - `SNIPER_REPEATABLE_BUY_PERCENT` (Defaults to _0_)
    - `SNIPER_REPEATABLE_SELL_PERCENT` (Defaults to _0_)
    - `SNIPER_REPEATABLE_BUY_AMOUNT_RANGE_SOL` (Defaults to _[0, 0]_)
    - `SNIPER_REPEATABLE_SELL_AMOUNT_RANGE_PERCENT` (Defaults to _[0, 0]_)
    - `TRADER_COUNT`
    - `TRADER_BALANCE_SOL`
    - `TRADER_BUY_AMOUNT_RANGE_SOL`
    - `TRADER_SELL_AMOUNT_RANGE_PERCENT`
    - `SWAPPER_GROUP_SIZE` (Defaults to _1_)
    - `SWAPPER_TRADE_DELAY_RANGE_SEC`

5. Run `yarn grind-keypairs` to grind the _main_ keypairs.

6. Run `yarn distribute-funds:dry-run` to estimate funds to transfer to the _main_ wallets.

7. Transfer the reported funds from to the _main_ wallets.

8. Run `yarn distribute-funds:dry-run` again to make sure that all the _main_ wallets have sufficient balances.

9. Run `yarn distribute-funds && yarn get-funds` to distribute funds to the sniper and trader wallets.

# Token Launch Plan

1. Run `yarn getenv` to make sure that the _production_ environment is set.

2. Create a meme image with a 1:1 aspect ratio and a size between 100x100 and 500x500 in the webp format, and save it under the _$TOKEN_SYMBOL.wepb_ name in the _images/production_ folder.

3. Set these environment variables in the _.env.production_ file:

    - `TOKEN_SYMBOL` (Replace the _TOKEN_ value with the actual one)
    - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
    - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
    - `TOKEN_WEBSITE_URI` (Defaults to _""_)
    - `TOKEN_TWITTER_URI` (Defaults to _""_)
    - `TOKEN_TELEGRAM_URI` (Defaults to _""_)
    - `TOKEN_TAGS` (Defaults to _"meme"_)

4. Run `yarn rename-token-files && yarn get-funds:main` to rename token key pair and storage files.

5. Run `yarn create-mint && yarn get-mint && yarn get-funds:main` to create the token mint.

6. Run `yarn open-pool:raydium && yarn get-pool:raydium && yarn get-funds:main` to open a Raydium CPMM pool and to lock liquidity in it.

7. Run `yarn trade:raydium` to make the traders trade in this pool.

8. Create a banner image with a 3:1 aspect ratio and a size between 600x200 and 1500x500 in the webp format, and save it under _$TOKEN_SYMBOL_banner.webp_ name in the _images/production_ folder.

9. Fill in the form to update token information and pay 299 USD on [Dexscreener](https://marketplace.dexscreener.com/product/token-info/order)

10. Check token trending on the platforms below:

- [DexScreener](https://dexscreener.com/6h?rankBy=trendingScoreH6&order=desc&chainIds=solana)
- [DexTools](https://www.dextools.io/app/en/solana/trending)
- [Defined](https://www.defined.fi/tokens/discover?network=sol&createdAt=hour12&rankingBy=volume&rankingDirection=DESC)

# Token Post Launch Plan

1. Adjust these environment variables in the _.env.production_ file.

    - `TRADER_COUNT`
    - `POOL_TRADING_CYCLE_COUNT`
    - `POOL_TRADING_PUMP_BIAS_PERCENT`
    - `POOL_TRADING_ONLY_NEW_TRADERS`

2. If `$TRADER_COUNT` is adjusted up, run `yarn distribute-funds:dry-run` to estimate funds to transfer to the _trader distributor_ wallet.

    - Transfer the reported funds to the _trader distributor_ wallet.

    - Run `yarn distribute-funds:dry-run` again to make sure that the _trader distributor_ wallet has sufficient balance.

    - Run `yarn distribute-funds` to distribute funds to the trader wallets.

    - Set `$POOL_TRADING_ONLY_NEW_TRADERS` to `true`.

3. Run `yarn trade:raydium` to make the traders trade in this pool.

# Token Exit Plan

1. Run `yarn close-pool:raydium && yarn collect-funds && yarn get-funds` to close the Raydium pool and to collect funds to the _main_ wallets.
