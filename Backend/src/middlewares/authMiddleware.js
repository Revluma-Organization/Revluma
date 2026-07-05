const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Check Authorization header exists and follows Bearer format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const user: Record<string, unknown> = {
            id: decoded.userId,
            email: decoded.email,
        };

        if (decoded.tenantId !== undefined) user.tenantId = decoded.tenantId;
        if (decoded.role !== undefined) user.role = decoded.role;

        req.user = user;

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
};

module.exports = {
    authenticateToken
};