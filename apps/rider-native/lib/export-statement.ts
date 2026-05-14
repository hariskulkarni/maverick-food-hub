/**
 * Export the rider's earnings statement.
 *
 * Pulls the CSV from /api/rider/reports/statement and hands it to the OS share
 * sheet via React Native's built-in `Share` — the rider can drop it into email,
 * Google Drive, WhatsApp, a spreadsheet app, etc. No extra native module needed.
 */
import { Share, Alert } from 'react-native';
import { api, ApiError } from './api';

export async function exportEarningsStatement(): Promise<void> {
  try {
    const csv = await api.fetchStatementText();
    if (!csv.trim() || csv.trim().split('\n').length <= 1) {
      Alert.alert('Nothing to export', 'No completed deliveries in this period yet.');
      return;
    }
    await Share.share({
      title: 'Oak & Sizzler — earnings statement',
      message: csv,
    });
  } catch (e) {
    Alert.alert(
      'Export failed',
      e instanceof ApiError ? e.message : 'Could not generate your statement. Try again.'
    );
  }
}
