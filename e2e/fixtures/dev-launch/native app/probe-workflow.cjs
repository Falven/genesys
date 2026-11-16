const { proxyActivities } = require("@temporalio/workflow");

const { launchDetails } = proxyActivities({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 1 },
});

exports.InspectLaunch = () => launchDetails();
