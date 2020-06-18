import fs from 'fs';
import csvParse from 'csv-parse';
import { getRepository, getCustomRepository, In } from 'typeorm';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

import TransactionsRepository from '../repositories/TransactionsRepository';
import AppError from '../errors/AppError';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    if (!filePath) {
      throw new AppError('ASd');
    }
    const contactsReadStream = fs.createReadStream(filePath);

    const transactionRepository = getCustomRepository(TransactionsRepository);
    const categoryRepository = getRepository(Category);

    const parses = csvParse({
      delimiter: ',',
      from_line: 2,
    });

    // vai ler as linhas conforme forem disponiveis
    const parseCSV = contactsReadStream.pipe(parses);

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);

      transactions.push({ title, type, value, category });
    });
    // quando o evento end for emitido ele vai retornar o que precisamos fazer
    await new Promise(resolve => parseCSV.on('end', resolve));

    // filtra os titulos a serem inseridos verificando se ja existem no BD
    const existentCategories = await categoryRepository.find({
      where: { title: In(categories) },
    });

    const categoryTitle = existentCategories.map(
      (category: Category) => category.title,
    );

    // retorna todas categorias que  NAO tem o titulo igual ao filtrado anteriormente
    const addCategoryTitles = categories
      .filter(category => !categoryTitle.includes(category))
      // remove os duplicados
      .filter((value, index, self) => self.indexOf(value) === index);

    // cria as categorias(sem duplicados) para inserir no banco
    const newCategory = categoryRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    // salva as categorias no banco
    await categoryRepository.save(newCategory);

    // retorna as categorias ja consultadas anteriormente(existentCategories) e as novas categories em uma array nova
    const allCategories = [...newCategory, ...existentCategories];

    // cria a transacao passando a categoria ja cadastrada
    const createdTransactions = transactionRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: allCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
