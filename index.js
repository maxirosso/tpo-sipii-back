require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');

// Initialize express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB Atlas using the MONGO_URI from the .env file
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
  imageUrl: { type: String }, // Optional field for Pokémon image
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});
const Card = mongoose.model('Card', CardSchema);

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) return res.sendStatus(403); // Forbidden

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Forbidden
    req.user = user;
    next();
  });
};

// Register route with card assignment
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });

    // Automatically assign a random Pokémon card to the user upon registration
    const randomCard = await Card.aggregate([{ $sample: { size: 1 } }]); // Get a random card
    if (randomCard.length > 0) {
      newUser.cards.push(randomCard[0]._id); // Add random card to user's collection
    }

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

// Fetch Pokémon data and save to DB
const fetchAndSavePokemonData = async () => {
  try {
    const response = await axios.get('https://pokeapi.co/api/v2/pokemon?limit=100'); // Fetch first 100 Pokémon
    const pokemons = response.data.results;

    for (const pokemon of pokemons) {
      const pokemonDetails = await axios.get(pokemon.url);
      const card = new Card({
        name: pokemon.name,
        imageUrl: pokemonDetails.data.sprites.front_default, // Get Pokémon image
      });

      await card.save();
      console.log(`Added Pokémon card: ${pokemon.name}`);
    }
  } catch (error) {
    console.error('Error fetching and saving Pokémon data:', error);
  }
};

// Fetch Pokémon data on server startup
fetchAndSavePokemonData();

// Get user's cards with populated card details
app.get('/api/cards', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).populate('cards');
    if (!user) return res.status(404).json({ error: 'User not found!' });

    console.log('Fetched user:', user); // Debugging user details
    console.log('User cards:', user.cards); // Debugging cards data

    res.json(user.cards);
  } catch (error) {
    console.error('Error fetching cards:', error); // Log detailed error
    res.status(500).json({ error: 'Failed to fetch cards!' });
  }
});

// Debug route to check if all cards are saved in the database
app.get('/api/all-cards-debug', async (req, res) => {
  try {
    const cards = await Card.find();
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch all cards!' });
  }
});

// Add a card to user's collection
// Add a card to user's collection
app.post('/api/add-card', authenticateToken, async (req, res) => {
  const { cardId } = req.body; // Expecting cardId in the request body

  try {
    const card = await Card.findById(cardId);
    if (!card) return res.status(404).json({ error: 'Card not found!' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found!' });

    // Add the card ID to the user's cards array
    user.cards.push(card._id);
    await user.save();

    res.status(201).json({ message: 'Card added to collection!' });
  } catch (error) {
    console.error('Error adding card:', error);
    res.status(500).json({ error: 'Failed to add card!' });
  }
});

app.post('/api/add-random-cards', authenticateToken, async (req, res) => {
  const numberOfCardsToAdd = 3; // Change this number to add more or fewer cards

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found!' });

    // Fetch random cards
    const randomCards = await Card.aggregate([{ $sample: { size: numberOfCardsToAdd } }]);

    if (randomCards.length === 0) {
      return res.status(404).json({ error: 'No cards found to add!' });
    }

    // Add random card IDs to the user's cards array
    randomCards.forEach(card => {
      if (!user.cards.includes(card._id)) { // Avoid duplicates
        user.cards.push(card._id);
      }
    });

    await user.save();
    res.status(201).json({ message: 'Random cards added to user\'s collection!', cards: randomCards });
  } catch (error) {
    console.error('Error adding random cards:', error);
    res.status(500).json({ error: 'Failed to add random cards!' });
  }
});

// Trade request route
app.post('/api/trade', authenticateToken, async (req, res) => {
  const { cardId, targetUserId } = req.body;

  try {
    const card = await Card.findById(cardId);
    if (!card) return res.status(404).json({ error: 'Card not found!' });
    if (card.owner && card.owner.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'You do not own this card!' });
    }
    
    card.owner = targetUserId;
    await card.save();
    
    res.json({ message: 'Card trade successful!' });
  } catch (error) {
    console.error('Error processing trade:', error); // Log detailed error
    res.status(500).json({ error: 'Trade request failed!' });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
