import { envVars, logger, prioritizationFees } from "../modules";
import { formatDecimal } from "../helpers/format";

(async () => {
    try {
        await getFees();
    } catch (err) {
        logger.fatal(err);
        process.exit(1);
    }
})();

async function getFees(): Promise<void> {
    await prioritizationFees.fetchFees();

    logger.info(
        "Prioritization fees (%s)\n\t\tAverage fee with 0s:\t%s\n\t\tAverage fee without 0s: %s\n\t\tMedian fee:\t\t%s",
        envVars.CLUSTER,
        formatDecimal(prioritizationFees.averageFeeIncludingZeros, 0),
        formatDecimal(prioritizationFees.averageFeeExcludingZeros, 0),
        formatDecimal(prioritizationFees.medianFee, 0)
    );
}
