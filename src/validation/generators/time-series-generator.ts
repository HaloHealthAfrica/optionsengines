/**
 * Time Series Generator for Validation Framework
 * 
 * Generates synthetic time series data covering market hours, after-hours,
 * and weekends for validation testing.
 */

import {
  TimeSeriesParams,
  TimeSeriesData,
  TimeSeriesDataPoint,
} from '../types/index.js';

/**
 * Time Series Generator
 * 
 * Creates realistic time series data for validation testing.
 */
export class TimeSeriesGenerator {
  /**
   * Generate time series data
   * 
   * @param params - Time series generation parameters
   * @returns Generated time series data
   */
  generateTimeSeries(params: TimeSeriesParams): TimeSeriesData {
    const dataPoints: TimeSeriesDataPoint[] = [];
    let currentDate = new Date(params.startDate);
    const endDate = new Date(params.endDate);
    let lastClose = 400; // Starting price

    while (currentDate <= endDate) {
      const isMarketHours = this.isMarketHours(currentDate);
      const isWeekend = this.isWeekend(currentDate);

      // Skip if conditions don't match params
      if (!params.includeAfterHours && !isMarketHours) {
        currentDate = this.incrementTime(currentDate, params.interval);
        continue;
      }

      if (!params.includeWeekends && isWeekend) {
        currentDate = this.incrementTime(currentDate, params.interval);
        continue;
      }

      // Generate OHLCV data
      const dataPoint = this.generateDataPoint(
        currentDate,
        lastClose,
        isMarketHours
      );

      dataPoints.push(dataPoint);
      lastClose = dataPoint.close;

      currentDate = this.incrementTime(currentDate, params.interval);
    }

    return {
      symbol: 'SPY', // Default symbol
      dataPoints,
    };
  }

  /**
   * Generate a single data point
   * 
   * @param timestamp - Timestamp for the data point
   * @param previousClose - Previous close price
   * @param isMarketHours - Whether it's during market hours
   * @returns Generated data point
   */
  private generateDataPoint(
    timestamp: Date,
    previousClose: number,
    isMarketHours: boolean
  ): TimeSeriesDataPoint {
    // Market hours have higher volatility and volume
    const volatility = isMarketHours ? 0.02 : 0.005;
    const volumeMultiplier = isMarketHours ? 1 : 0.1;

    const open = previousClose * (1 + (Math.random() - 0.5) * volatility);
    const close = open * (1 + (Math.random() - 0.5) * volatility);
    const high = Math.max(open, close) * (1 + Math.random() * volatility);
    const low = Math.min(open, close) * (1 - Math.random() * volatility);
    const volume = Math.floor((Math.random() * 1000000 + 100000) * volumeMultiplier);

    return {
      timestamp: new Date(timestamp),
      open,
      high,
      low,
      close,
      volume,
      marketHours: isMarketHours,
    };
  }

  /**
   * Check if timestamp is during market hours
   * 
   * @param date - Date to check
   * @returns True if during market hours
   */
  private isMarketHours(date: Date): boolean {
    const hour = date.getHours();
    const day = date.getDay();

    // Weekend
    if (day === 0 || day === 6) {
      return false;
    }

    // Market hours: 9:30 AM - 4:00 PM ET (simplified to 9-16)
    return hour >= 9 && hour < 16;
  }

  /**
   * Check if date is a weekend
   * 
   * @param date - Date to check
   * @returns True if weekend
   */
  private isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  /**
   * Increment time based on interval
   * 
   * @param date - Current date
   * @param interval - Time interval
   * @returns New date
   */
  private incrementTime(date: Date, interval: 'minute' | 'hour' | 'day'): Date {
    const newDate = new Date(date);

    switch (interval) {
      case 'minute':
        newDate.setMinutes(newDate.getMinutes() + 1);
        break;
      case 'hour':
        newDate.setHours(newDate.getHours() + 1);
        break;
      case 'day':
        newDate.setDate(newDate.getDate() + 1);
        break;
    }

    return newDate;
  }

  /**
   * Generate time series for a specific date range
   * 
   * @param days - Number of days
   * @param interval - Time interval
   * @returns Time series data
   */
  generateForDays(days: number, interval: 'minute' | 'hour' | 'day' = 'hour'): TimeSeriesData {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.generateTimeSeries({
      startDate,
      endDate,
      interval,
      includeAfterHours: true,
      includeWeekends: true,
    });
  }

  /**
   * Generate time series for market hours only
   * 
   * @param days - Number of days
   * @returns Time series data
   */
  generateMarketHoursOnly(days: number): TimeSeriesData {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.generateTimeSeries({
      startDate,
      endDate,
      interval: 'hour',
      includeAfterHours: false,
      includeWeekends: false,
    });
  }

  /**
   * Generate time series including after-hours
   * 
   * @param days - Number of days
   * @returns Time series data
   */
  generateWithAfterHours(days: number): TimeSeriesData {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.generateTimeSeries({
      startDate,
      endDate,
      interval: 'hour',
      includeAfterHours: true,
      includeWeekends: false,
    });
  }
}

/**
 * Default time series generator instance
 */
export const timeSeriesGenerator = new TimeSeriesGenerator();
