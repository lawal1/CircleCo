function formatCurrency(amount) {
  return `₦${amount.toLocaleString()}`;
}

async function uploadFile(file) {
  // Example: upload to Firebase Storage
  const storageRef = firebase.storage().ref();
  const fileRef = storageRef.child(`documents/${Date.now()}_${file.name}`);
  const snapshot = await fileRef.put(file);
  const url = await snapshot.ref.getDownloadURL();
  return url;
}