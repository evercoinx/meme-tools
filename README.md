# Meme Tools

# Token Launch Plan

1. Create a meme image, convert it to the webp format, and save it under _{token}.wepb_ name in _images/production_ folder.

2. Fill in the following environment variables in `.env.production` file:

    - `TOKEN_SYMBOL`
    - `TOKEN_NAME`
    - `TOKEN_TWITTER_URI`
    - `TOKEN_TELEGRAM_URI`

3. Run `yarn setenv:prod` to set the production environment.

4. Run `yarn grind-keypairs` to grind _dev_ and _distributor_ keypairs.

5. Run `yarn distribute-funds:dry-run` to estimate amount of funds from _distributor_ wallet to snipers and traders.

6. Transfer the required funds from _main_ wallet to _dev_ and _distributor_ wallets.

7. Run `yarn start:prod` to distribute funds from _distributor_ wallet to all the snipers and traders, to create the token, to open a CPMM pool on Raydium and to burn liqudity on that pool.

8. Run `yarn trade-raydium-pool` to make traders execute buys and sells on that pool.

9. Check token trending on [Dexscreener](https://dexscreener.com/?rankBy=trendingScoreM5&order=desc) and [Dextools](https://www.dextools.io/app/en/solana/pairs)
