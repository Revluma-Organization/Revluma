const prisma = require("../configs/database");

exports.ingest = async (req, res, next) => {
  try {
    const {
      store_id,
      session_id,
      event_type,
      customer_id,
      payload,
    } = req.body;

    // Validate required fields
    const missingFields = [];

    if (!store_id) missingFields.push("store_id");
    if (!session_id) missingFields.push("session_id");
    if (!event_type) missingFields.push("event_type");

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    // Verify store exists
    const store = await prisma.store.findUnique({
      where: {
        id: store_id,
      },
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found.",
      });
    }

    // Store event
    const event = await prisma.events.create({
      data: {
        store_id,
        session_id,
        event_type,
        customer_id: customer_id || null,
        payload: payload || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Event ingested successfully.",
      data: event,
    });

  } catch (error) {
    next(error);
  }
};
