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
    - `TRADER_COUNT`
    - `TRADER_GROUP_SIZE` (Defaults to _1_)
    - `TRADER_BALANCE_SOL`
    - `TRADER_BUY_AMOUNT_RANGE_SOL`
    - `TRADER_SELL_AMOUNT_RANGE_PERCENT`
    - `TRADER_SWAP_DELAY_RANGE_SEC`

5. Run `yarn grind-keypairs` to grind the _main_ keypairs.

6. Run `yarn distribute-funds:dry-run` to estimate funds to transfer to the _main_ wallets.

7. Transfer amount equal to `$POOL_LIQUIDITY_SOL + 0.15 SOL (pool creation fee) + 0.1 SOL (gas fees)` to the _dev_ wallet.

8. Transfer amount equal to `$SNIPER_AMOUNT_SOL + 0.01 SOL (gas fees)` to the _sniper distributor_ wallet.

9. Transfer amount equal to `$TRADER_AMOUNT_SOL + 0.01 SOL (gas fees)` to the _trader distributor_ wallet.

10. Run `yarn get-funds:main` to get funds of the _main_ wallets.

11. Run `yarn distribute-funds:view` to distribute funds to the sniper and trader wallets.

# Token Launch Plan

1. Run `yarn setenv:prod` to set the _production_ environment.

2. Create a meme image, convert it to the webp format, and save it under the _$TOKEN_SYMBOL.wepb_ name in the _images/production_ folder.

3. Set these environment variables in the _.env.production_ file:

    - `TOKEN_SYMBOL` (Replace the _TOKEN_ value with the actual one)
    - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
    - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
    - `TOKEN_WEBSITE_URI` (Defaults to _""_)
    - `TOKEN_TWITTER_URI` (Defaults to _""_)
    - `TOKEN_TELEGRAM_URI` (Defaults to _""_)
    - `TOKEN_TAGS` (Defaults to _"meme"_)

4. Run `yarn rename-token-files && yarn get-funds:main` to rename token key pair and storage files.

5. Run `yarn create-mint:view && yarn get-funds:main` to create the token mint.

6. Run `yarn open-raydium-pool && yarn lock-raydium-pool-liquidity` to open a Raydium CPMM pool and to lock liquidity in it.

7. Run `yarn trade-raydium-pool` to make the traders execute buys and sells on this pool.

8. Check how the token trends on [Dexscreener](https://dexscreener.com/?rankBy=trendingScoreM5&order=desc) and [Dextools](https://www.dextools.io/app/en/solana/pairs).

# Token Post Launch Plan

1. Adjust these environment variables in the _.env.production_ file.

    - `POOL_TRADING_PUMP_BIAS_PERCENT`
    - `TRADER_COUNT`

2. If `$TRADER_COUNT` is adjusted up, run `yarn distribute-funds:dry-run` to estimate funds to transfer to the _trader distributor_ wallet.

3. If `$TRADER_COUNT` is adjusted up, transfer `$TRADER_AMOUNT_SOL + 0.01 SOL (gas fees)` to the _trader distributor_ wallet.

4. Run `yarn distribute-funds` to distribute funds to the sniper and trader wallets.

5. Run `yarn trade-raydium-pool` to make the traders execute buys and sells on this pool.

# Token Exit Plan

1. Run `yarn close-raydium-pool && yarn collect-funds:view` to close the Raydium pool and to collect funds on the _main_ wallets.
