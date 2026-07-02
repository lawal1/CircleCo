const mongoose = require('mongoose');
const loanRuleSchema = new mongoose.Schema({
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, unique: true },
  minMonthsSaved: { type: Number, default: 6 }
});
module.exports = mongoose.model('LoanRule', loanRuleSchema);