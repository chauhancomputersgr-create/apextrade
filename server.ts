import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import https from "https";

dotenv.config();

// Initialize Express App
const app = express();
const PORT = 3000;

app.use(express.json());

// In-Memory Database
interface DBUser {
  id: string;
  username: string;
  email: string;
  phone?: string;
  password?: string;
  registeredWeek?: number; // Added to distinguish weekly registrations
  isApproved?: boolean; // True for admin approval
  initialBalance: number;
  balance: number;
  equity: number;
  dailyStartingBalance: number;
  isLiquidated: boolean;
  isAdmin: boolean;
  registeredAt: string;
  emailNotifications: boolean;
}

interface DBTrade {
  id: string;
  userId: string;
  username: string;
  asset: 'BTC' | 'GOLD';
  type: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  leverage: number;
  marginUsed: number;
  openTime: string;
  closeTime?: string;
  status: 'OPEN' | 'CLOSED';
  pnl: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAlerts: string[];
}

interface DBState {
  users: DBUser[];
  trades: DBTrade[];
  prices: {
    BTC: { price: number; high: number; low: number; prevPrice: number };
    GOLD: { price: number; high: number; low: number; prevPrice: number };
  };
  tournament: {
    isActive: boolean;
    weekNumber: number;
    startDate: string;
    endDate: string;
    totalPrizePool: number;
    status: 'ACTIVE' | 'COMPLETED' | 'UPCOMING';
  };
}

// Global In-Memory Store
const state: DBState = {
  users: [
    {
      id: "admin",
      username: "Arena Admin",
      email: "chauhancomputersgr@gmail.com",
      password: "admin",
      initialBalance: 0,
      balance: 0,
      equity: 0,
      dailyStartingBalance: 0,
      isLiquidated: false,
      isAdmin: true,
      registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      emailNotifications: false,
    },
    // Seed traders to make leaderboard look alive and fun!
    {
      id: "AT201",
      username: "AT201",
      email: "goldsniper@gmail.com",
      phone: "9812345678",
      password: "pass1",
      registeredWeek: 21,
      isApproved: true,
      initialBalance: 10000,
      balance: 11450,
      equity: 11450,
      dailyStartingBalance: 10800,
      isLiquidated: false,
      isAdmin: false,
      registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      emailNotifications: true,
    },
    {
      id: "AT202",
      username: "AT202",
      email: "cryptobull@gmail.com",
      phone: "9988776655",
      password: "pass2",
      registeredWeek: 21,
      isApproved: true,
      initialBalance: 10000,
      balance: 10850,
      equity: 11200, // Open profit
      dailyStartingBalance: 10100,
      isLiquidated: false,
      isAdmin: false,
      registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
      emailNotifications: true,
    },
    {
      id: "AT203",
      username: "AT203",
      email: "riskmanager@gmail.com",
      phone: "9123456789",
      password: "pass3",
      registeredWeek: 21,
      isApproved: true,
      initialBalance: 10000,
      balance: 10150,
      equity: 10150,
      dailyStartingBalance: 10000,
      isLiquidated: false,
      isAdmin: false,
      registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      emailNotifications: false,
    },
    {
      id: "AT204",
      username: "AT204",
      email: "levking@gmail.com",
      phone: "9555554444",
      password: "pass4",
      registeredWeek: 21,
      isApproved: true,
      initialBalance: 10000,
      balance: 4800,
      equity: 4800,
      dailyStartingBalance: 8500,
      isLiquidated: true, // overall loss limit (>50%)
      isAdmin: false,
      registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
      emailNotifications: true,
    },
  ],
  trades: [
    {
      id: "t1",
      userId: "AT201",
      username: "AT201",
      asset: "GOLD",
      type: "BUY",
      entryPrice: 4515.5,
      exitPrice: 4538.2,
      quantity: 1,
      leverage: 100,
      marginUsed: 45.16,
      openTime: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
      closeTime: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      status: "CLOSED",
      pnl: 2270,
      stopLoss: 4490,
      takeProfit: 4550,
      riskAlerts: ["Fixed Competition Leverage is 100x."],
    },
    {
      id: "t2",
      userId: "AT202",
      username: "AT202",
      asset: "BTC",
      type: "BUY",
      entryPrice: 77200,
      quantity: 0.5,
      leverage: 100,
      marginUsed: 386,
      openTime: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      status: "OPEN",
      pnl: 50, // open pnl
      stopLoss: 75000,
      takeProfit: 80000,
      riskAlerts: ["Fixed Competition Leverage is 100x."],
    }
  ],
  prices: {
    BTC: { price: 77300.0, high: 77700.0, low: 76900.0, prevPrice: 77200.0 },
    GOLD: { price: 4555.00, high: 4575.0, low: 4535.0, prevPrice: 4550.00 }
  },
  tournament: {
    isActive: true,
    weekNumber: 21,
    startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(), // Mon
    endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString(), // Fri
    totalPrizePool: 5000,
    status: 'ACTIVE'
  }
};

// Robust HTTPS request helper that works across all Node versions without external fetch
function fetchWithTimeout(url: string, timeoutMs: number = 3000): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            ok: (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300),
            status: res.statusCode || 200,
            json: async () => parsed
          });
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', (err) => {
        reject(err);
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

// Price generator simulator and real-time fetcher running on backend
async function updateRealTimePrices() {
  try {
    let btcFetched = false;
    let goldFetched = false;

    try {
      // Fetch live BTC price from Binance using robust helper
      const btcRes = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
      if (btcRes.ok) {
        const btcData = await btcRes.json() as { price: string };
        const val = parseFloat(btcData.price);
        if (!isNaN(val) && val > 0) {
          state.prices.BTC.prevPrice = state.prices.BTC.price;
          state.prices.BTC.price = val;
          if (state.prices.BTC.price > state.prices.BTC.high) state.prices.BTC.high = state.prices.BTC.price;
          if (state.prices.BTC.price < state.prices.BTC.low) state.prices.BTC.low = state.prices.BTC.price;
          btcFetched = true;
        }
      }
    } catch (err) {
      // console.error("BTC Binance live price fetch error:", err);
    }

    try {
      // First attempt to fetch live high-fidelity interbank Spot Gold (XAUUSD) from the free gold-api.com to match the OANDA chart
      const xauRes = await fetchWithTimeout("https://api.gold-api.com/price/XAU");
      if (xauRes.ok) {
        const xauData = await xauRes.json();
        const rawVal = xauData && (xauData.price || xauData.price_gram_24k * 31.1034768); // 1 troy ounce = 31.1034768 grams
        const val = typeof rawVal === 'number' ? rawVal : parseFloat(rawVal);
        if (!isNaN(val) && val > 0) {
          state.prices.GOLD.prevPrice = state.prices.GOLD.price;
          state.prices.GOLD.price = val;
          if (state.prices.GOLD.price > state.prices.GOLD.high) state.prices.GOLD.high = state.prices.GOLD.price;
          if (state.prices.GOLD.price < state.prices.GOLD.low) state.prices.GOLD.low = state.prices.GOLD.price;
          goldFetched = true;
        }
      }
    } catch (err) {
      // console.warn("Failed to fetch Gold Spot from primary gold-api:", err);
    }

    if (!goldFetched) {
      try {
        // Fetch live GoldSpot equivalent from PAXGUSDT (one troy ounce physical Gold) using robust helper
        const goldRes = await fetchWithTimeout("https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT");
        if (goldRes.ok) {
          const goldData = await goldRes.json() as { price: string };
          const val = parseFloat(goldData.price);
          if (!isNaN(val) && val > 0) {
            state.prices.GOLD.prevPrice = state.prices.GOLD.price;
            state.prices.GOLD.price = val;
            if (state.prices.GOLD.price > state.prices.GOLD.high) state.prices.GOLD.high = state.prices.GOLD.price;
            if (state.prices.GOLD.price < state.prices.GOLD.low) state.prices.GOLD.low = state.prices.GOLD.price;
            goldFetched = true;
          }
        }
      } catch (err) {
        // console.error("GOLD (PAXG) Binance live price fetch fallback error:", err);
      }
    }

  // Fallback simulator for BTC
  if (!btcFetched) {
    const btcChange = (Math.random() - 0.49) * 45; // slightly upwards
    state.prices.BTC.prevPrice = state.prices.BTC.price;
    state.prices.BTC.price = parseFloat((state.prices.BTC.price + btcChange).toFixed(2));
    if (state.prices.BTC.price > state.prices.BTC.high) state.prices.BTC.high = state.prices.BTC.price;
    if (state.prices.BTC.price < state.prices.BTC.low) state.prices.BTC.low = state.prices.BTC.price;
  }

  // Fallback simulator for GOLD
  if (!goldFetched) {
    const goldChange = (Math.random() - 0.5) * 1.8;
    state.prices.GOLD.prevPrice = state.prices.GOLD.price;
    state.prices.GOLD.price = parseFloat((state.prices.GOLD.price + goldChange).toFixed(2));
    if (state.prices.GOLD.price > state.prices.GOLD.high) state.prices.GOLD.high = state.prices.GOLD.price;
    if (state.prices.GOLD.price < state.prices.GOLD.low) state.prices.GOLD.low = state.prices.GOLD.price;
  }

  // Handle open trade P&L simulation & potential liquidation
  state.trades.forEach(t => {
    if (t.status === 'OPEN') {
      const livePrice = state.prices[t.asset].price;
      const difference = livePrice - t.entryPrice;
      const sign = t.type === 'BUY' ? 1 : -1;
      
      // Check SL/TP trigger first
      let triggered = false;
      let exitPriceOfTrigger = livePrice;

      if (t.stopLoss !== undefined && t.stopLoss !== null && !isNaN(t.stopLoss)) {
        if (t.type === 'BUY' && livePrice <= t.stopLoss) {
          triggered = true;
          exitPriceOfTrigger = t.stopLoss;
        } else if (t.type === 'SELL' && livePrice >= t.stopLoss) {
          triggered = true;
          exitPriceOfTrigger = t.stopLoss;
        }
      }

      if (t.takeProfit !== undefined && t.takeProfit !== null && !isNaN(t.takeProfit) && !triggered) {
        if (t.type === 'BUY' && livePrice >= t.takeProfit) {
          triggered = true;
          exitPriceOfTrigger = t.takeProfit;
        } else if (t.type === 'SELL' && livePrice <= t.takeProfit) {
          triggered = true;
          exitPriceOfTrigger = t.takeProfit;
        }
      }

      const user = state.users.find(u => u.id === t.userId);

      if (triggered && user && !user.isLiquidated) {
        // Close trade automatically hitting SL/TP target!
        const finalDifference = exitPriceOfTrigger - t.entryPrice;
        const finalPnl = parseFloat((finalDifference * t.quantity * t.leverage * sign).toFixed(2));

        t.exitPrice = exitPriceOfTrigger;
        t.pnl = finalPnl;
        t.status = 'CLOSED';
        t.closeTime = new Date().toISOString();

        // Update user balances
        user.balance = parseFloat((user.balance + finalPnl).toFixed(2));
        user.equity = user.balance;

        // Drawdown alerts on closure
        const totalDrawdown = (user.initialBalance - user.equity) / user.initialBalance;
        const dailyDrawdown = (user.dailyStartingBalance - user.equity) / user.dailyStartingBalance;

        if (totalDrawdown >= 0.50 || dailyDrawdown >= 0.10) {
          user.isLiquidated = true;
        }
      } else {
        // Calculate active PnL
        // PnL = (LivePrice - EntryPrice) * Quantity * Leverage * Sign
        t.pnl = parseFloat((difference * t.quantity * t.leverage * sign).toFixed(2));

        // Check liquidation or trigger rules
        if (user && !user.isLiquidated) {
          user.equity = parseFloat((user.balance + t.pnl).toFixed(2));

          // Drawdown alerts
          const totalDrawdown = (user.initialBalance - user.equity) / user.initialBalance;
          const dailyDrawdown = (user.dailyStartingBalance - user.equity) / user.dailyStartingBalance;

          if (totalDrawdown >= 0.50 || dailyDrawdown >= 0.10) {
            // Liquidate
            user.isLiquidated = true;
            user.balance = parseFloat(user.equity.toFixed(2));
            t.exitPrice = livePrice;
            t.status = 'CLOSED';
            t.closeTime = new Date().toISOString();
            t.pnl = parseFloat((t.pnl).toFixed(2));
          }
        }
      }
    }
  });

  // Calculate equities for users without open positions
  state.users.forEach(u => {
    const activeUserTrades = state.trades.filter(t => t.userId === u.id && t.status === 'OPEN');
    if (activeUserTrades.length === 0) {
      u.equity = u.balance;
    }
  });
  } catch (err) {
    console.error("Critical error in updateRealTimePrices loop:", err);
  }
}

// Set up background poll interval
setInterval(updateRealTimePrices, 2500);

// Helper function to lazily initialize GoogleGenAI
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not defined in the environment secrets.");
    }
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return geminiClient;
}

// ------ API ENDPOINTS ------

// Get real-time prices
app.get("/api/prices", (req, res) => {
  res.json(state.prices);
});

// Helper function to generate fallback historical candles if Binance fails or is offline
function generateFallbackCandles(asset: 'BTC' | 'GOLD', tf: string, currentPrice: number) {
  const count = 120; // plentiful history for zoom capabilities
  const list: any[] = [];
  
  let stepMult = 1;
  if (tf === '5m') stepMult = 5;
  if (tf === '15m') stepMult = 15;
  if (tf === '30m') stepMult = 30;
  if (tf === '1h') stepMult = 60;
  if (tf === 'daily') stepMult = 1440;

  const baseVal = currentPrice || (asset === 'BTC' ? 77300 : 4555);
  const volFactor = asset === 'BTC' ? 100 : 6.0;
  const tfMult = tf === '1m' ? 1 : tf === '5m' ? 1.8 : tf === '15m' ? 2.8 : tf === '30m' ? 3.8 : tf === '1h' ? 5.5 : 12.0;
  
  let iteratedClose = baseVal - (count * volFactor * tfMult * 0.1);
  const startMs = Date.now() - count * stepMult * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const change = (Math.sin(i / 3) * 0.6 + (Math.random() - 0.5)) * volFactor * tfMult;
    const open = parseFloat(iteratedClose.toFixed(2));
    const close = parseFloat((iteratedClose + change).toFixed(2));
    const high = parseFloat((Math.max(open, close) + Math.random() * (volFactor * 0.4 * tfMult)).toFixed(2));
    const low = parseFloat((Math.min(open, close) - Math.random() * (volFactor * 0.4 * tfMult)).toFixed(2));
    
    const candleTime = new Date(startMs + i * stepMult * 60 * 1000);
    let timeFormatted = '';
    if (tf === 'daily') {
      timeFormatted = candleTime.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else {
      timeFormatted = candleTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    list.push({ open, high, low, close, time: timeFormatted });
    iteratedClose = close;
  }

  if (list.length > 0) {
    const finalCandle = list[list.length - 1];
    finalCandle.close = currentPrice;
    finalCandle.high = Math.max(finalCandle.high, currentPrice);
    finalCandle.low = Math.min(finalCandle.low, currentPrice);
  }

  return list;
}

// Fetch live historical candlesticks from Binance or fallback seamlessly
app.get("/api/historical-candles", async (req, res) => {
  const asset = (req.query.asset as string || 'BTC').toUpperCase();
  const tf = req.query.timeframe as string || '1m';

  // Map to Binance symbol and interval
  const symbol = asset === 'GOLD' ? 'PAXGUSDT' : 'BTCUSDT';
  let interval = '1m';
  if (tf === '5m') interval = '5m';
  else if (tf === '15m') interval = '15m';
  else if (tf === '30m') interval = '30m';
  else if (tf === '1h') interval = '1h';
  else if (tf === 'daily') interval = '1d';

  try {
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=120`;
    const response = await fetchWithTimeout(binanceUrl, 4000);
    
    if (!response.ok) {
      throw new Error(`Binance API returned status ${response.status}`);
    }

    const data = await response.json() as any[];
    
    // Map response array to our Candle interface:
    // [0] openTime, [1] open, [2] high, [3] low, [4] close, [5] volume
    const mappedCandles = data.map((item) => {
      const openTime = item[0];
      const candleTime = new Date(openTime);
      
      let timeFormatted = '';
      if (tf === 'daily') {
        timeFormatted = candleTime.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } else {
        timeFormatted = candleTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      return {
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        time: timeFormatted
      };
    });

    res.json(mappedCandles);
  } catch (err) {
    // Fall back to generated historical candles seamlessly so the chart NEVER fails!
    const activePrice = state.prices[asset as 'BTC' | 'GOLD']?.price || (asset === 'BTC' ? 77300.00 : 4555.00);
    const generated = generateFallbackCandles(asset as 'BTC' | 'GOLD', tf, activePrice);
    res.json(generated);
  }
});

// Helper to generate sequential trader IDs starting with AT201
function generateNextTraderId(): string {
  const atUsers = state.users.filter(u => u.id.startsWith("AT2"));
  if (atUsers.length === 0) {
    return "AT201";
  }
  let maxNum = 200;
  for (const u of atUsers) {
    const numPart = u.id.slice(3); // after "AT2"
    const parsed = parseInt(numPart, 10);
    if (!isNaN(parsed) && parsed > maxNum) {
      maxNum = parsed;
    }
  }
  return "AT2" + (maxNum + 1);
}

// User self-registration
app.post("/api/auth/register", (req, res) => {
  const { email, phone } = req.body;
  if (!email || !phone) {
    return res.status(400).json({ error: "Email ID and mobile number are both compulsory." });
  }

  const existingEmail = state.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingEmail) {
    return res.status(400).json({ error: "Email already registered." });
  }

  const existingPhone = state.users.find(u => u.phone && u.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
  if (existingPhone) {
    return res.status(400).json({ error: "Mobile number already registered." });
  }

  // Auto generate secure password
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  let generatedPassword = "";
  for (let i = 0; i < 8; i++) {
    generatedPassword += chars[Math.floor(Math.random() * chars.length)];
  }

  const nextId = generateNextTraderId();

  const newUser: DBUser = {
    id: nextId,
    username: nextId, // Auto-generate sequential username handle (e.g., AT205) matching unique ID
    email,
    phone,
    password: generatedPassword,
    registeredWeek: state.tournament.weekNumber + 1, // Track registration week (always the next week starting next Monday)
    isApproved: false, // Self-registered user starts as UNAPPROVED/PENDING PAYMENT
    initialBalance: 10000,
    balance: 10000,
    equity: 10000,
    dailyStartingBalance: 10000,
    isLiquidated: false,
    isAdmin: false,
    registeredAt: new Date().toISOString(),
    emailNotifications: true
  };

  state.users.push(newUser);
  res.json({ message: "Registration successful!", user: newUser });
});

// Authentication Endpoint
app.post("/api/auth/login", (req, res) => {
  const { loginId, email, password } = req.body; // Support both loginId or fallback email
  const identifier = loginId || email;
  if (!identifier || !password) {
    return res.status(400).json({ error: "Login ID/Mobile and password are required." });
  }

  const user = state.users.find(u => {
    const isPassOk = u.password === password;
    if (!isPassOk) return false;

    // Check if matches Email
    if (u.email && u.email.toLowerCase() === identifier.toLowerCase()) {
      return true;
    }

    // Check if matches Phone (ignoring non-digits standard)
    if (u.phone) {
      const dbDigits = u.phone.replace(/\D/g, '');
      const inputDigits = identifier.replace(/\D/g, '');
      if (dbDigits && inputDigits && dbDigits === inputDigits) {
        return true;
      }
      if (u.phone.trim() === identifier.trim()) {
        return true;
      }
    }

    // Backup match with ID
    if (u.id.toLowerCase() === identifier.toLowerCase()) {
      return true;
    }

    return false;
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. Please make sure phone/email and password match." });
  }

  // Verify registration week to prevent old members logging in
  if (!user.isAdmin && (user.registeredWeek || 21) !== state.tournament.weekNumber) {
    return res.status(403).json({ 
      error: `Your account is registered for Week #${user.registeredWeek || 21}. You can only log in during your registered week. Please register a brand new account for the current active Week #${state.tournament.weekNumber} competition!`
    });
  }

  // Verify registration approval to check ₹499 payment
  if (!user.isAdmin && user.isApproved === false) {
    return res.status(403).json({
      error: "ACCOUNT_PENDING_APPROVAL",
      message: "Your registration is pending ₹499 payment approval. Please complete payment of ₹499 and send the screenshot to WhatsApp +91 6266007440 to activate your account.",
      phone: user.phone,
      username: user.username,
      password: user.password,
      registeredWeek: user.registeredWeek
    });
  }

  res.json({ message: "Login successful", user });
});

// Submit a active trade order
app.post("/api/trades", (req, res) => {
  const { userId, asset, type, quantity, stopLoss, takeProfit } = req.body;
  
  if (!userId || !asset || !type || !quantity) {
    return res.status(400).json({ error: "Missing required transaction parameters." });
  }

  const finalLeverage = 100;

  if (asset === 'BTC' && (quantity < 0.1 || quantity > 5)) {
    return res.status(400).json({ error: "Trade quantity for BTC must be between 0.1 and 5." });
  }
  if (asset === 'GOLD' && (quantity < 0.01 || quantity > 5)) {
    return res.status(400).json({ error: "Trade quantity for GOLD must be between 0.01 and 5." });
  }

  const user = state.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  if (user.isLiquidated) {
    return res.status(400).json({ error: "Your account is currently locked due to limit breaching (drawdown / maximum loss reached)." });
  }

  const activeTrade = state.trades.find(t => t.userId === userId && t.status === 'OPEN');
  if (activeTrade) {
    return res.status(400).json({ error: "You can only have one active trade at a time in this competition rules." });
  }

  const currentPrice = state.prices[asset as 'BTC' | 'GOLD'].price;
  const rawCost = currentPrice * quantity;
  const marginUsed = parseFloat((rawCost / finalLeverage).toFixed(2));

  if (marginUsed > user.balance) {
    return res.status(400).json({ error: `Insufficient cash. Margin requirement: $${marginUsed}, Available: $${user.balance}. Please reduce trade size.` });
  }

  // Pre-calculate risk management alerts (strictly requested: "har trade par risk management alert zaroor aana chahiye.")
  const riskAlerts: string[] = [];
  riskAlerts.push(`Fixed Competition Leverage is ${finalLeverage}x.`);
  if (marginUsed > user.balance * 0.25) {
    riskAlerts.push(`High Margin Exposure Alert: You are risking ${((marginUsed/user.balance)*100).toFixed(1)}% of your equity in a single trade!`);
  }
  if (!stopLoss) {
    riskAlerts.push("No Stop Loss Applied: Highly vulnerable to sudden liquidation peaks.");
  } else {
    // Validate custom stop loss bounds
    const slDiff = Math.abs(currentPrice - stopLoss);
    const slLossPotential = slDiff * quantity * finalLeverage;
    if (slLossPotential > user.balance * 0.10) {
      riskAlerts.push(`Risky Stop Loss Boundary: Triggering SL could result in over 10% loss ($${slLossPotential.toFixed(2)}), breaching daily drawdown instantly!`);
    }
  }

  const newTrade: DBTrade = {
    id: "trade_" + Math.random().toString(36).substr(2, 9),
    userId,
    username: user.username,
    asset: asset as 'BTC' | 'GOLD',
    type: type as 'BUY' | 'SELL',
    entryPrice: currentPrice,
    quantity,
    leverage: finalLeverage,
    marginUsed,
    openTime: new Date().toISOString(),
    status: 'OPEN',
    pnl: 0,
    stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
    takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
    riskAlerts
  };

  state.trades.push(newTrade);
  res.json({ message: "Trade executed successfully!", trade: newTrade });
});

// Close an active trade order
app.post("/api/trades/:id/close", (req, res) => {
  const { id } = req.params;
  const trade = state.trades.find(t => t.id === id);
  if (!trade) {
    return res.status(404).json({ error: "Trade not found" });
  }

  if (trade.status === 'CLOSED') {
    return res.status(400).json({ error: "Trade is already closed." });
  }

  const user = state.users.find(u => u.id === trade.userId);
  if (!user) {
    return res.status(404).json({ error: "User not found associated to the trade." });
  }

  const exitPrice = state.prices[trade.asset].price;
  const difference = exitPrice - trade.entryPrice;
  const sign = trade.type === 'BUY' ? 1 : -1;
  const finalPnl = parseFloat((difference * trade.quantity * trade.leverage * sign).toFixed(2));

  trade.exitPrice = exitPrice;
  trade.pnl = finalPnl;
  trade.status = 'CLOSED';
  trade.closeTime = new Date().toISOString();

  // Update user balances
  user.balance = parseFloat((user.balance + finalPnl).toFixed(2));
  user.equity = user.balance;

  // Re-verify if drawdown limit gets breached on closure
  const totalDrawdown = (user.initialBalance - user.equity) / user.initialBalance;
  const dailyDrawdown = (user.dailyStartingBalance - user.equity) / user.dailyStartingBalance;

  if (totalDrawdown >= 0.50 || dailyDrawdown >= 0.10) {
    user.isLiquidated = true;
  }

  res.json({ message: "Trade closed successfully", trade });
});

// Update stop loss and take profit of an active trade order
app.post("/api/trades/:id/update-sl-tp", (req, res) => {
  const { id } = req.params;
  const { stopLoss, takeProfit } = req.body;

  const trade = state.trades.find(t => t.id === id);
  if (!trade) {
    return res.status(404).json({ error: "Trade not found" });
  }

  if (trade.status === 'CLOSED') {
    return res.status(400).json({ error: "Trade is already closed." });
  }

  // Parse values. If string or empty, handle appropriately.
  trade.stopLoss = stopLoss !== undefined && stopLoss !== "" && stopLoss !== null ? parseFloat(stopLoss) : undefined;
  trade.takeProfit = takeProfit !== undefined && takeProfit !== "" && takeProfit !== null ? parseFloat(takeProfit) : undefined;

  // Let's also validate the new stopLoss and takeProfit if needed, but simple update is fine.
  res.json({ message: "SL/TP targets updated successfully", trade });
});

// Load user active and past trades
app.get("/api/trades/:userId", (req, res) => {
  const { userId } = req.params;
  const userTrades = state.trades.filter(t => t.userId === userId);
  res.json(userTrades);
});

// Retrieve dynamic Daily and Weekly Leaderboards
app.get("/api/leaderboard", (req, res) => {
  const queryWeek = req.query.week ? parseInt(req.query.week as string, 10) : NaN;
  const targetWeek = !isNaN(queryWeek) ? queryWeek : state.tournament.weekNumber;

  const activeTraders = state.users.filter(u => !u.isAdmin && (u.registeredWeek || 21) === targetWeek);

  // Daily performance metric = % gain or loss today compared to dailyStartingBalance
  const dailyLead = activeTraders.map(u => {
    const gain = u.equity - u.dailyStartingBalance;
    const pnlPercent = u.dailyStartingBalance > 0 ? (gain / u.dailyStartingBalance) * 100 : 0;
    return {
      userId: u.id,
      username: u.username,
      phone: u.phone,
      pnl: parseFloat(gain.toFixed(2)),
      pnlPercent: parseFloat(pnlPercent.toFixed(2)),
      balance: u.equity,
      isLiquidated: u.isLiquidated
    };
  }).sort((a, b) => b.pnlPercent - a.pnlPercent)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  // Weekly performance metric = % gain or loss this week compared to initialBalance
  const weeklyLead = activeTraders.map(u => {
    const gain = u.equity - u.initialBalance;
    const pnlPercent = (gain / u.initialBalance) * 100;
    return {
      userId: u.id,
      username: u.username,
      phone: u.phone,
      pnl: parseFloat(gain.toFixed(2)),
      pnlPercent: parseFloat(pnlPercent.toFixed(2)),
      balance: u.equity,
      isLiquidated: u.isLiquidated
    };
  }).sort((a, b) => b.pnlPercent - a.pnlPercent)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  // Collect all unique registered weeks
  const allWeeks = Array.from(new Set(state.users.filter(u => !u.isAdmin).map(u => u.registeredWeek || 21))).sort((a, b) => b - a);
  if (!allWeeks.includes(state.tournament.weekNumber)) {
    allWeeks.push(state.tournament.weekNumber);
    allWeeks.sort((a, b) => b - a);
  }

  res.json({
    daily: dailyLead,
    weekly: weeklyLead,
    weeks: allWeeks,
    rules: {
      dailyDrawdownLimit: "10%",
      maxTotalLoss: "50%",
      activeWeeklyCompetition: `Week #${targetWeek}`,
      status: targetWeek === state.tournament.weekNumber ? state.tournament.status : "CLOSED"
    }
  });
});

// AI Professional Performance Analytics generation with Gemini API
app.post("/api/analytics", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required for analytics." });
  }

  const user = state.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "Traders session expired." });
  }

  const userTrades = state.trades.filter(t => t.userId === userId);

  try {
    const ai = getGeminiClient();
    
    // Construct rich historical prompt to get high-quality portfolio report
    const tradeSummaryText = userTrades.map((t, idx) => {
      return `${idx+1}. Asset: ${t.asset}, Size: ${t.quantity}, Type: ${t.type}, Leverage: ${t.leverage}x, Entry Price: $${t.entryPrice}, Exit Price: $${t.exitPrice || 'STILL OPEN'}, Status: ${t.status}, PnL: $${t.pnl}, Alerts Triggered: [${t.riskAlerts.join(", ")}]`;
    }).join("\n");

    const prompt = `You are a world-class institutional risk officer and proprietary trading manager. 
Analyze this trader's demo competition profile and output a beautiful formatted JSON performance analytics report.

TRADER DETAILS:
- Username: ${user.username}
- Current Account Equity: $${user.equity}
- Liquidated Status: ${user.isLiquidated ? 'YES (Breached daily 10% drawdown or 50% max overall loss limits)' : 'NO (Account is clean and active)'}
- Initial Balance: $${user.initialBalance}

TRADING LOG:
${tradeSummaryText || 'No trades executed yet.'}

RULES TO RESPOND:
Provide an expert performance assessment. Your response must be JSON only. No markdown annotations around JSON. Exactly this structure:
{
  "overallScore": number (0 to 100),
  "riskGrade": string ("A" | "B" | "C" | "D" | "F"),
  "drawdownRisk": string (descriptive summary of risk proximity e.g. "LOW", "MEDIUM", "SEVERE CRITICAL BREACH"),
  "recommendations": string[] (minimum 3 expert feedback sentences),
  "geminiAnalysis": string (detailed breakdown in markdown containing analysis of asset choice, risk patterns, leverage traps, and actionable tips for the competition)
}

Be direct, highly analytic, and avoid generic fluff. Only output valid JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const reportText = response.text || "{}";
    const reportData = JSON.parse(reportText.trim());

    res.json(reportData);

  } catch (error: any) {
    console.error("Gemini API Error: ", error);
    res.status(500).json({ 
      error: "Could not generate AI report currently. Ensure your GEMINI_API_KEY is configured properly.",
      details: error.message
    });
  }
});

// Admin Route: Get Users
app.get("/api/admin/users", (req, res) => {
  res.json(state.users);
});

// Admin Route: Create custom user logins
app.post("/api/admin/create-user", (req, res) => {
  const { username, email, phone } = req.body;
  if (!username || !email || !phone) {
    return res.status(400).json({ error: "Missing identity attributes. Username, Email, and Phone/WhatsApp are required." });
  }

  const existingPhone = state.users.find(u => u.phone && u.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
  if (existingPhone) {
    return res.status(400).json({ error: "Mobile number already registered to another competitor." });
  }

  // Create customized password generator
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let password = "";
  for(let i=0; i<6; i++) {
    password += letters[Math.floor(Math.random() * letters.length)];
  }

  const newUser: DBUser = {
    id: generateNextTraderId(),
    username,
    email,
    phone,
    password,
    registeredWeek: state.tournament.weekNumber + 1, // Track registration week (always the next week starting next Monday)
    isApproved: true, // Manually onboarded by administrator is automatically active
    initialBalance: 10000,
    balance: 10000,
    equity: 10000,
    dailyStartingBalance: 10000,
    isLiquidated: false,
    isAdmin: false,
    registeredAt: new Date().toISOString(),
    emailNotifications: true
  };

  state.users.push(newUser);
  res.json({ message: "Participant created successfully!", user: newUser });
});

// Admin Route: Toggle user approval status
app.post("/api/admin/toggle-approval", (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }
  const user = state.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "Trader profile not found." });
  }
  user.isApproved = !user.isApproved;
  res.json({ message: `Trader ${user.username} state updated successfully!`, user });
});

// Admin Route: Export old members (from previous weeks) to Excel/CSV format
app.get("/api/admin/export-old-members", (req, res) => {
  const currentWeek = state.tournament.weekNumber;
  const oldUsers = state.users.filter(u => !u.isAdmin && (u.registeredWeek || 21) !== currentWeek);
  
  if (oldUsers.length === 0) {
    // Generate empty csv with headers anyway so it downloads safely
    const headers = ["ID", "Username", "Email", "Phone", "Registered Week", "Registered At", "Final Balance", "Final Equity", "Liquidated"];
    const csvContent = headers.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=no_old_members_yet.csv`);
    return res.send(csvContent);
  }

  // Create CSV content
  const headers = ["ID", "Username", "Email", "Phone", "Registered Week", "Registered At", "Final Balance", "Final Equity", "Liquidated"];
  const rows = oldUsers.map(u => [
    u.id,
    u.username,
    u.email,
    u.phone || "",
    u.registeredWeek || 21,
    u.registeredAt,
    u.balance,
    u.equity,
    u.isLiquidated ? "YES" : "NO"
  ]);

  const csvContent = [
    headers.join(","), 
    ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=old_members_archives_week_${currentWeek}.csv`);
  res.send(csvContent);
});

// Admin Route: Reset tournament and schedule new weekly competition
app.post("/api/admin/reset", (req, res) => {
  const { nextWeekNumber, startDate, endDate } = req.body;
  
  state.tournament.weekNumber = nextWeekNumber || state.tournament.weekNumber + 1;
  state.tournament.startDate = startDate ? new Date(startDate).toISOString() : new Date().toISOString();
  state.tournament.endDate = endDate ? new Date(endDate).toISOString() : new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
  state.tournament.status = 'ACTIVE';

  // Recalibrate and reset all trading competition balances
  state.users.forEach(u => {
    if (!u.isAdmin) {
      u.balance = 10000;
      u.equity = 10000;
      u.dailyStartingBalance = 10000;
      u.isLiquidated = false;
    }
  });

  // Clear demo trades to prevent past tournament overlap
  state.trades = state.trades.filter(t => t.status === 'OPEN');

  const startFormatted = new Date(state.tournament.startDate).toLocaleDateString();
  const endFormatted = new Date(state.tournament.endDate).toLocaleDateString();

  res.json({ 
    message: `Tournament reset successfully! New weekly sequence: Week #${state.tournament.weekNumber} activated (Period: ${startFormatted} to ${endFormatted}). All user balances calibrated to $10,000.`, 
    tournament: state.tournament 
  });
});

// Admin Route: Trigger Custom Price Shocks (for active simulator demoing)
app.post("/api/admin/shock", (req, res) => {
  const { asset, changePercent } = req.body;
  if (!asset || !changePercent) {
    return res.status(400).json({ error: "Missing shock arguments." });
  }

  const target = asset as 'BTC' | 'GOLD';
  const multiplier = 1 + (parseFloat(changePercent) / 100);
  state.prices[target].prevPrice = state.prices[target].price;
  state.prices[target].price = parseFloat((state.prices[target].price * multiplier).toFixed(2));
  
  res.json({ message: `Simulated price shock of ${changePercent}% applied to ${asset}. Current price: $${state.prices[target].price}`, prices: state.prices });
});


// ------ VITE MIDDLEWARE CONFIGURATION ------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Competition Arena listening on http://localhost:${PORT}`);
  });
}

startServer();
