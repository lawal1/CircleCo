async function loadSavingsChart() {
  // Fetch savings timeline data from backend (you'll need to implement this endpoint)
  // For demo, we use dummy data
  const ctx = document.getElementById('savingsChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [{
        label: 'Total Savings (₦)',
        data: [1000, 2500, 4000, 6000, 8500, 12000],
        borderColor: '#0d6efd',
        fill: false,
      }]
    }
  });
}