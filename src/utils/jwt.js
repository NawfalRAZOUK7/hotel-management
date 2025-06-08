const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Configuration des tokens depuis les variables d'environnement
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '24h';
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '7d';
const JWT_ISSUER = process.env.JWT_ISSUER || 'hotel-management-system';

// Vérification de la configuration
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined in environment variables');
}

// Set pour stocker les tokens blacklistés (en production, utilisez Redis)
const blacklistedTokens = new Set();

/**
 * Générer un token d'accès JWT
 * @param {Object} payload - Données à encoder dans le token
 * @param {Object} options - Options supplémentaires
 * @returns {String} Token JWT signé
 */
const generateAccessToken = (payload, options = {}) => {
  try {
    // Validation du payload
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload doit être un objet');
    }

    if (!payload.userId) {
      throw new Error('userId est requis dans le payload');
    }

    // Payload standardisé
    const tokenPayload = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
      type: 'access',
      // Timestamp pour validation
      iat: Math.floor(Date.now() / 1000)
    };

    // Options par défaut
    const defaultOptions = {
      expiresIn: JWT_EXPIRE,
      issuer: JWT_ISSUER,
      audience: 'hotel-users',
      subject: String(payload.userId)
    };

    // Fusion des options
    const finalOptions = { ...defaultOptions, ...options };

    // Génération du token
    const token = jwt.sign(tokenPayload, JWT_SECRET, finalOptions);

    return token;
  } catch (error) {
    throw new Error(`Erreur génération token d'accès: ${error.message}`);
  }
};

/**
 * Générer un refresh token
 * @param {String} userId - ID de l'utilisateur
 * @param {Object} options - Options supplémentaires
 * @returns {String} Refresh token signé
 */
const generateRefreshToken = (userId, options = {}) => {
  try {
    if (!userId) {
      throw new Error('userId est requis');
    }

    const tokenPayload = {
      userId: String(userId),
      type: 'refresh',
      // Token ID unique pour révocation
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000)
    };

    const defaultOptions = {
      expiresIn: JWT_REFRESH_EXPIRE,
      issuer: JWT_ISSUER,
      audience: 'hotel-refresh',
      subject: String(userId)
    };

    const finalOptions = { ...defaultOptions, ...options };

    const refreshToken = jwt.sign(tokenPayload, JWT_REFRESH_SECRET, finalOptions);

    return refreshToken;
  } catch (error) {
    throw new Error(`Erreur génération refresh token: ${error.message}`);
  }
};

/**
 * Vérifier et décoder un token d'accès
 * @param {String} token - Token à vérifier
 * @param {Object} options - Options de vérification
 * @returns {Object} Payload décodé
 */
const verifyAccessToken = (token, options = {}) => {
  try {
    if (!token) {
      throw new Error('Token manquant');
    }

    // Vérifier si le token est blacklisté
    if (blacklistedTokens.has(token)) {
      throw new Error('Token révoqué');
    }

    const defaultOptions = {
      issuer: JWT_ISSUER,
      audience: 'hotel-users'
    };

    const finalOptions = { ...defaultOptions, ...options };

    const decoded = jwt.verify(token, JWT_SECRET, finalOptions);

    // Vérification du type de token
    if (decoded.type !== 'access') {
      throw new Error('Type de token invalide');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expiré');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Token invalide');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token pas encore valide');
    }
    
    throw new Error(`Erreur vérification token: ${error.message}`);
  }
};

/**
 * Vérifier un refresh token
 * @param {String} refreshToken - Refresh token à vérifier
 * @param {Object} options - Options de vérification
 * @returns {Object} Payload décodé
 */
const verifyRefreshToken = (refreshToken, options = {}) => {
  try {
    if (!refreshToken) {
      throw new Error('Refresh token manquant');
    }

    // Vérifier si le token est blacklisté
    if (blacklistedTokens.has(refreshToken)) {
      throw new Error('Refresh token révoqué');
    }

    const defaultOptions = {
      issuer: JWT_ISSUER,
      audience: 'hotel-refresh'
    };

    const finalOptions = { ...defaultOptions, ...options };

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET, finalOptions);

    // Vérification du type de token
    if (decoded.type !== 'refresh') {
      throw new Error('Type de token invalide');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Refresh token expiré');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Refresh token invalide');
    }
    
    throw new Error(`Erreur vérification refresh token: ${error.message}`);
  }
};

/**
 * Générer une paire de tokens (access + refresh)
 * @param {Object} user - Objet utilisateur
 * @returns {Object} Paire de tokens avec informations
 */
const generateTokenPair = (user) => {
  try {
    if (!user || !user._id) {
      throw new Error('Objet utilisateur invalide');
    }

    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role,
      fullName: user.fullName || `${user.firstName} ${user.lastName}`
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(user._id);

    // Décoder pour obtenir les dates d'expiration
    const accessDecoded = jwt.decode(accessToken);
    const refreshDecoded = jwt.decode(refreshToken);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessDecoded.exp - accessDecoded.iat,
      accessTokenExpires: new Date(accessDecoded.exp * 1000),
      refreshTokenExpires: new Date(refreshDecoded.exp * 1000),
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        fullName: payload.fullName
      }
    };
  } catch (error) {
    throw new Error(`Erreur génération paire de tokens: ${error.message}`);
  }
};

/**
 * Renouveler un token d'accès avec un refresh token
 * @param {String} refreshToken - Refresh token valide
 * @param {Function} getUserById - Fonction pour récupérer l'utilisateur
 * @returns {Object} Nouveau token d'accès
 */
const refreshAccessToken = async (refreshToken, getUserById) => {
  try {
    // Vérifier le refresh token
    const decoded = verifyRefreshToken(refreshToken);
    
    // Récupérer l'utilisateur depuis la base de données
    const user = await getUserById(decoded.userId);
    
    if (!user || !user.isActive) {
      throw new Error('Utilisateur non trouvé ou inactif');
    }

    // Générer un nouveau token d'accès
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role,
      fullName: user.fullName || `${user.firstName} ${user.lastName}`
    };

    const newAccessToken = generateAccessToken(payload);
    const accessDecoded = jwt.decode(newAccessToken);

    return {
      accessToken: newAccessToken,
      tokenType: 'Bearer',
      expiresIn: accessDecoded.exp - accessDecoded.iat,
      accessTokenExpires: new Date(accessDecoded.exp * 1000),
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        fullName: payload.fullName
      }
    };
  } catch (error) {
    throw new Error(`Erreur renouvellement token: ${error.message}`);
  }
};

/**
 * Blacklister un token (déconnexion)
 * @param {String} token - Token à blacklister
 * @returns {Boolean} Succès de l'opération
 */
const blacklistToken = (token) => {
  try {
    if (!token) {
      return false;
    }

    // Ajouter à la blacklist
    blacklistedTokens.add(token);

    // En production, stocker dans Redis avec TTL
    // redis.setex(`blacklist:${token}`, ttl, '1');

    return true;
  } catch (error) {
    console.error('Erreur blacklist token:', error);
    return false;
  }
};

/**
 * Vérifier si un token est blacklisté
 * @param {String} token - Token à vérifier
 * @returns {Boolean} True si blacklisté
 */
const isTokenBlacklisted = (token) => {
  return blacklistedTokens.has(token);
};

/**
 * Extraire le token d'un header Authorization
 * @param {String} authHeader - Header Authorization
 * @returns {String|null} Token extrait ou null
 */
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) {
    return null;
  }

  // Format attendu: "Bearer <token>"
  const parts = authHeader.split(' ');
  
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
};

/**
 * Décoder un token sans vérification (pour debug)
 * @param {String} token - Token à décoder
 * @returns {Object|null} Payload décodé ou null
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

/**
 * Obtenir les informations d'expiration d'un token
 * @param {String} token - Token à analyser
 * @returns {Object} Informations d'expiration
 */
const getTokenExpiration = (token) => {
  try {
    const decoded = decodeToken(token);
    
    if (!decoded || !decoded.exp) {
      return null;
    }

    const expiresAt = new Date(decoded.exp * 1000);
    const now = new Date();
    const isExpired = expiresAt <= now;
    const timeUntilExpiry = expiresAt - now;

    return {
      expiresAt,
      isExpired,
      timeUntilExpiry: isExpired ? 0 : timeUntilExpiry,
      hoursUntilExpiry: isExpired ? 0 : Math.floor(timeUntilExpiry / (1000 * 60 * 60)),
      minutesUntilExpiry: isExpired ? 0 : Math.floor(timeUntilExpiry / (1000 * 60))
    };
  } catch (error) {
    return null;
  }
};

/**
 * Valider la force d'un JWT_SECRET
 * @param {String} secret - Secret à valider
 * @returns {Object} Résultat de la validation
 */
const validateJwtSecret = (secret) => {
  if (!secret) {
    return { isValid: false, message: 'Secret manquant' };
  }

  if (secret.length < 32) {
    return { isValid: false, message: 'Secret trop court (minimum 32 caractères)' };
  }

  if (secret === 'your-secret-key' || secret === 'secret') {
    return { isValid: false, message: 'Secret par défaut non sécurisé' };
  }

  // Vérifier la complexité
  const hasUpperCase = /[A-Z]/.test(secret);
  const hasLowerCase = /[a-z]/.test(secret);
  const hasNumbers = /\d/.test(secret);
  const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(secret);

  const complexity = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChars].filter(Boolean).length;

  if (complexity < 3) {
    return { 
      isValid: false, 
      message: 'Secret pas assez complexe (utilisez majuscules, minuscules, chiffres et caractères spéciaux)' 
    };
  }

  return { 
    isValid: true, 
    message: 'Secret valide',
    strength: complexity === 4 ? 'Excellent' : 'Bon'
  };
};

/**
 * Nettoyer les tokens expirés de la blacklist (tâche de maintenance)
 * @returns {Number} Nombre de tokens nettoyés
 */
const cleanupBlacklist = () => {
  let cleaned = 0;
  
  blacklistedTokens.forEach(token => {
    const expiration = getTokenExpiration(token);
    if (expiration && expiration.isExpired) {
      blacklistedTokens.delete(token);
      cleaned++;
    }
  });

  return cleaned;
};

module.exports = {
  // Génération de tokens
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  
  // Vérification de tokens
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
  
  // Gestion de la blacklist
  blacklistToken,
  isTokenBlacklisted,
  
  // Utilitaires
  extractTokenFromHeader,
  decodeToken,
  getTokenExpiration,
  validateJwtSecret,
  cleanupBlacklist,
  
  // Configuration (pour debug)
  config: {
    JWT_EXPIRE,
    JWT_REFRESH_EXPIRE,
    JWT_ISSUER,
    secretIsValid: validateJwtSecret(JWT_SECRET).isValid
  }
};