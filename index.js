require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// Initialize express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// User model
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  cards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }]
});
const User = mongoose.model('User', UserSchema);

// Card model
const CardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});
const Card = mongoose.model('Card', CardSchema);

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.sendStatus(403);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Register route
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: 'User created successfully!' });
  } catch (error) {
    res.status(400).json({ error: 'User registration failed!' });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found!' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password!' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Login failed!' });
  }
});

// Get user's cards
app.get('/api/cards', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('cards');
    res.json(user.cards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cards!' });
  }
});

// Get all cards (for trading purposes)
app.get('/api/all-cards', async (req, res) => {
  try {
    const cards = await Card.find().populate('owner', 'username');
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch all cards!' });
  }
});

// Add a card to user's collection
app.post('/api/add-card', authenticateToken, async (req, res) => {
  const { cardName } = req.body;

  try {
    const card = new Card({ name: cardName, owner: req.user.userId });
    await card.save();

    const user = await User.findById(req.user.userId);
    user.cards.push(card);
    await user.save();

    res.status(201).json({ message: 'Card added to collection!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add card!' });
  }
});

// Trade request route
app.post('/api/trade', authenticateToken, async (req, res) => {
  const { cardId, targetUserId } = req.body;

  try {
    const card = await Card.findById(cardId);
    if (card.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'You do not own this card!' });
    }
    card.owner = targetUserId;
    await card.save();
    res.json({ message: 'Card trade successful!' });
  } catch (error) {
    res.status(500).json({ error: 'Trade request failed!' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
