const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth.middleware');

const {
  createTicket,
  getAllTickets,
  getMyReportedTickets,
  getTicketsAssignedToMe,
  getTicketById,
  updateTicketStatus,
  addTicketUpdate
} = require('../controllers/ticket.controller');

router.use(protect);

router.route('/')
  .post(createTicket)                    // Reporter + others
  .get(restrictTo('Admin','Manager'), getAllTickets);

router.get('/my-reported', getMyReportedTickets);
router.get('/assigned-to-me', getTicketsAssignedToMe);

router.route('/:id')
  .get(getTicketById);

router.patch('/:id/status', restrictTo('Engineer','Operator','Admin','Manager'), updateTicketStatus);
router.post('/:id/updates', addTicketUpdate);

module.exports = router;
