// This wraps your controller functions and passes any thrown error directly to next()
module.exports = fn => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};