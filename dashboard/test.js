const x = [{ metrics: { insertions: 5, deletions: 2 } }]
const itemChurn = x[0].metrics.insertions + x[0].metrics.deletions;
console.log(itemChurn)
