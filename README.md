# Meme Tools

# Token Pre Launch Plan

1. Run `yarn generate-shares` to generate pool shares for the snipers.

2. Set the environment variables below in the _.env.production_ file:

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

# Token Launch Plan

1. Create a meme image, convert it to the webp format, and save it under the _{token}.wepb_ name in the _images/production_ folder.

2. Set the environment variables below in the _.env.production_ file:

    - `TOKEN_SYMBOL`
    - `TOKEN_NAME` (Defaults to _"Official $TOKEN_NAME $TOKEN_TAGS0"_)
    - `TOKEN_DESCRIPTION` (Defaults to _"$TOKEN_NAME" on Solana"_)
    - `TOKEN_WEBSITE_URI` (Defaults to _""_)
    - `TOKEN_TWITTER_URI` (Defaults to _""_)
    - `TOKEN_TELEGRAM_URI` (Defaults to _""_)
    - `TOKEN_TAGS` (Defaults to _"meme"_)

3. Run `yarn setenv:prod` to set the _production_ environment.

4. Run `yarn get-config` to check the current environment configuration.

5. Run `yarn grind-keypairs` to grind the _dev_ and _distributor_ keypairs.

6. Transfer SOL amount equal to `$POOL_LIQUIDITY_SOL + 0.15 SOL (pool creation fee) + 0.05 SOL (gas fees)` from the _main_ wallet to the _dev_ wallet.

7. Run `yarn distribute-funds:dry-run` to estimate SOL amount to distribute from the _distributor_ wallet to the snipers and traders. Then transfer `estimated SOL + 0.01 SOL (gas fees)` from the _main_ wallet to the _distributor_ wallet.

8. Run `yarn start:prod` to distribute funds from the _distributor_ wallet to the snipers and traders, to create the token, to open a Raydium CPMM pool and to burn liqudity in it.

9. Run `yarn trade-raydium-pool` to make the traders execute buys and sells on that pool.

10. Check token trending on [Dexscreener](https://dexscreener.com/?rankBy=trendingScoreM5&order=desc) and [Dextools](https://www.dextools.io/app/en/solana/pairs).

# Token Post Launch Plan

1. Adjust environment variables below in the _.env.production_ file.

    - `TRADER_COUNT`
    - `POOL_TRADING_PUMP_BIAS_PERCENT`

2. If `$TRADER_COUNT` is adjusted up, run `yarn distribute-funds:dry-run` to estimate SOL amount to distribute from the _distributor_ wallet to the snipers and traders.

3. If `$TRADER_COUNT` is adjusted up, transfer `estimated SOL + 0.01 SOL (gas fees)` from the _main_ wallet to the _distributor_ wallet.

4. Run `yarn distribute-funds` to distribute funds from the _distributor_ wallet to the snipers and traders.

5. Run `yarn trade-raydium-pool` to make the traders execute buys and sells on that pool.
