import { Hono } from 'hono';
import Container from 'typedi';
import { ReportController } from '../controllers/report.controller';

const reportRoutes = new Hono();
const controller = Container.get(ReportController);

reportRoutes.post('/', controller.createReport);
reportRoutes.get('/:id', controller.getReportStatus);
reportRoutes.get('/', controller.getAllReports);
reportRoutes.get('/:id/download', controller.downloadReport);

export default reportRoutes;
